# app/routers/note.py
import json
import os
import uuid
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, BackgroundTasks, UploadFile, File
from pydantic import BaseModel, validator, field_validator, model_validator
from dataclasses import asdict

from app.db.video_task_dao import get_task_by_video
from app.enmus.exception import NoteErrorEnum
from app.enmus.note_enums import DownloadQuality
from app.exceptions.note import NoteError
from app.services.note import NoteGenerator, logger
from app.services.task_serial_executor import task_serial_executor
from app.utils.response import ResponseWrapper as R
from app.utils.url_parser import extract_video_id, normalize_video_url
from app.validators.video_url_validator import is_supported_video_url
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
import httpx
from app.enmus.task_status_enums import TaskStatus

# from app.services.downloader import download_raw_audio
# from app.services.whisperer import transcribe_audio

router = APIRouter()


class RecordRequest(BaseModel):
    video_id: str
    platform: str


class VideoRequest(BaseModel):
    video_url: str
    platform: str
    quality: DownloadQuality
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    model_name: str
    provider_id: str
    task_id: Optional[str] = None
    format: Optional[list] = []
    style: str = None
    extras: Optional[str]=None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []
    # 客户端（如浏览器插件）已经在用户浏览器里抓到字幕，直接传给后端复用，
    # 跳过 download_subtitles 和音频转写。形如：
    #   {"language": "zh", "full_text": "...", "segments": [{"start","end","text"}, ...]}
    prefetched_transcript: Optional[dict] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_url(cls, data):
        # 稍后再看/收藏夹/带追踪参数的 B 站链接先规范化成标准 /video/BVxxx 形式，
        # 后续校验和 yt-dlp 下载拿到的都是干净链接
        if isinstance(data, dict) and data.get("platform") == "bilibili" and data.get("video_url"):
            data["video_url"] = normalize_video_url(str(data["video_url"]))
        return data

    @field_validator("video_url")
    def validate_supported_url(cls, v):
        url = str(v)
        parsed = urlparse(url)
        if parsed.scheme in ("http", "https"):
            # 是网络链接，继续用原有平台校验
            if not is_supported_video_url(url):
                raise NoteError(code=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.code,
                                message=NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message)

        return v


class BatchVideoItem(BaseModel):
    video_url: str
    platform: str


class BatchVideoRequest(BaseModel):
    # 平台由前端按 URL 推断后逐条传入；每条一个 task_id，串行队列逐条执行
    items: List[BatchVideoItem]
    quality: DownloadQuality
    model_name: str
    provider_id: str
    screenshot: Optional[bool] = False
    link: Optional[bool] = False
    format: Optional[list] = []
    style: Optional[str] = None
    extras: Optional[str] = None
    video_understanding: Optional[bool] = False
    video_interval: Optional[int] = 0
    grid_size: Optional[list] = []


NOTE_OUTPUT_DIR = os.getenv("NOTE_OUTPUT_DIR", "note_results")
UPLOAD_DIR = "uploads"


def save_note_to_file(task_id: str, note):
    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json"), "w", encoding="utf-8") as f:
        json.dump(asdict(note), f, ensure_ascii=False, indent=2)


def _persist_prefetched_transcript(task_id: str, transcript: dict) -> None:
    """把客户端预取的字幕写到 NoteGenerator 期望的转写缓存文件里。

    NoteGenerator.generate 会优先读 <task_id>_transcript.json，命中即跳过 download_subtitles
    与音频转写流程。要求字段：language(可空)/full_text/segments[{start,end,text}]
    """
    segments = transcript.get("segments") or []
    cleaned_segments = []
    for s in segments:
        text = (s.get("text") or "").strip()
        if not text:
            continue
        cleaned_segments.append({
            "start": float(s.get("start", 0)),
            "end": float(s.get("end", 0)),
            "text": text,
        })
    if not cleaned_segments:
        raise ValueError("prefetched_transcript 没有可用的 segments")

    full_text = transcript.get("full_text") or " ".join(s["text"] for s in cleaned_segments)
    payload = {
        "language": transcript.get("language") or "zh",
        "full_text": full_text,
        "segments": cleaned_segments,
    }

    os.makedirs(NOTE_OUTPUT_DIR, exist_ok=True)
    target = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}_transcript.json")
    with open(target, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    logger.info(f"已写入客户端预取字幕缓存: {target} ({len(cleaned_segments)} 段)")


def run_note_task(task_id: str, video_url: str, platform: str, quality: DownloadQuality,
                  link: bool = False, screenshot: bool = False, model_name: str = None, provider_id: str = None,
                  _format: list = None, style: str = None, extras: str = None, video_understanding: bool = False,
                  video_interval=0, grid_size=[]
                  ):

    def _mark_failed(message: str):
        # 任务状态文件已由调用方写成 PENDING：任何入口异常都必须落到 FAILED，
        # 否则前端会无限轮询一个永远不会执行的"排队中"任务
        try:
            NoteGenerator()._update_status(task_id, TaskStatus.FAILED, message)
        except Exception:
            logger.error(f"写 FAILED 状态失败 (task_id={task_id})")

    if not model_name or not provider_id:
        _mark_failed("请选择模型和提供者")
        return

    def _execute_note_task():
        return NoteGenerator().generate(
            video_url=video_url,
            platform=platform,
            quality=quality,
            task_id=task_id,
            model_name=model_name,
            provider_id=provider_id,
            link=link,
            _format=_format,
            style=style,
            extras=extras,
            screenshot=screenshot,
            video_understanding=video_understanding,
            video_interval=video_interval,
            grid_size=grid_size,
        )

    logger.info(f"任务进入执行队列 (task_id={task_id})")
    try:
        note = task_serial_executor.run(_execute_note_task)
    except Exception as e:
        logger.error(f"任务执行异常 (task_id={task_id})：{e}", exc_info=True)
        _mark_failed(str(e))
        return
    logger.info(f"Note generated: {task_id}")
    if not note or not note.markdown:
        logger.warning(f"任务 {task_id} 执行失败，跳过保存")
        return
    save_note_to_file(task_id, note)

    # 自动建立向量索引（用于 AI 问答），失败不影响笔记生成
    try:
        from app.services.vector_store import VectorStoreManager
        VectorStoreManager().index_task(task_id)
    except Exception as e:
        logger.warning(f"向量索引失败（不影响笔记）: {e}")


@router.post('/delete_task')
def delete_task(data: RecordRequest):
    try:
        # TODO: 待持久化完成
        # NoteGenerator().delete_note(video_id=data.video_id, platform=data.platform)
        return R.success(msg='删除成功')
    except Exception as e:
        return R.error(msg=e)


@router.post("/upload")
async def upload(file: UploadFile = File(...)):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_location = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_location, "wb+") as f:
        f.write(await file.read())

    # 假设你静态目录挂载了 /uploads
    return R.success({"url": f"/uploads/{file.filename}"})


@router.post("/generate_note")
def generate_note(data: VideoRequest, background_tasks: BackgroundTasks):
    try:
        # 就绪门禁：本地转写引擎（fast-whisper / mlx-whisper）必须等模型下载完才能跑视频，
        # 否则任务会卡在首次下载（慢 / OOM / 截断），用户只看到一个静默失败的任务。
        # 客户端已抓好字幕（prefetched_transcript）则不需要转写，跳过检查。
        if not data.prefetched_transcript:
            from app.services.transcriber_config_manager import TranscriberConfigManager
            readiness = TranscriberConfigManager().is_model_ready()
            if not readiness["ready"]:
                logger.warning(f"拒绝 generate_note：{readiness['reason']}")
                return R.error(
                    msg=readiness["reason"],
                    code=300102,
                    data={
                        "reason": "transcriber_model_not_ready",
                        "transcriber_type": readiness["transcriber_type"],
                        "model_size": readiness["model_size"],
                        "downloading": readiness["downloading"],
                    },
                )

        video_id = extract_video_id(data.video_url, data.platform)
        # if not video_id:
        #     raise HTTPException(status_code=400, detail="无法提取视频 ID")
        # existing = get_task_by_video(video_id, data.platform)
        # if existing:
        #     return R.error(
        #         msg='笔记已生成，请勿重复发起',
        #
        #     )
        if data.task_id:
            # 如果传了task_id，说明是重试！
            task_id = data.task_id
            logger.info(f"重试模式，复用已有 task_id={task_id}")
        else:
            # 正常新建任务
            task_id = str(uuid.uuid4())

        # 统一先写入 PENDING，表示已进入队列等待串行执行
        NoteGenerator()._update_status(task_id, TaskStatus.PENDING)

        # 客户端已经抓好字幕的话，写到转写缓存文件，NoteGenerator 的 cache-hit 逻辑会直接用上
        if data.prefetched_transcript:
            try:
                _persist_prefetched_transcript(task_id, data.prefetched_transcript)
            except Exception as e:
                logger.warning(f"写入预取字幕失败 (task_id={task_id}): {e}")

        background_tasks.add_task(run_note_task, task_id, data.video_url, data.platform, data.quality, data.link,
                                  data.screenshot, data.model_name, data.provider_id, data.format, data.style,
                                  data.extras, data.video_understanding, data.video_interval, data.grid_size)
        return R.success({"task_id": task_id})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# 单批任务数上限：防止一次请求入队数千任务占满执行队列（自我 DoS）
MAX_BATCH_ITEMS = 100


@router.post("/generate_notes_batch")
def generate_notes_batch(data: BatchVideoRequest, background_tasks: BackgroundTasks):
    """批量生成笔记：复用单条的 run_note_task + 执行队列，逐条入队。

    单条 URL 无效不阻塞整批，失败原因随该条返回（task_id=None）。
    """
    if len(data.items) > MAX_BATCH_ITEMS:
        return R.error(msg=f"单批最多 {MAX_BATCH_ITEMS} 条任务，请分批提交", code=400)
    try:
        # 就绪门禁与单条一致，批量开头检查一次
        from app.services.transcriber_config_manager import TranscriberConfigManager
        readiness = TranscriberConfigManager().is_model_ready()
        if not readiness["ready"]:
            logger.warning(f"拒绝 generate_notes_batch：{readiness['reason']}")
            return R.error(
                msg=readiness["reason"],
                code=300102,
                data={
                    "reason": "transcriber_model_not_ready",
                    "transcriber_type": readiness["transcriber_type"],
                    "model_size": readiness["model_size"],
                    "downloading": readiness["downloading"],
                },
            )

        # 循环外实例化一次：只为写 PENDING 状态文件，不必每条重建
        status_writer = NoteGenerator()

        results = []
        for item in data.items:
            try:
                video_url = item.video_url
                if item.platform == "bilibili":
                    # 与单条接口一致：稍后再看/收藏夹/带追踪参数的链接先规范化
                    video_url = normalize_video_url(str(video_url))
                if not is_supported_video_url(video_url):
                    results.append({
                        "video_url": video_url,
                        "platform": item.platform,
                        "task_id": None,
                        "error": NoteErrorEnum.PLATFORM_NOT_SUPPORTED.message,
                    })
                    continue

                task_id = str(uuid.uuid4())
                status_writer._update_status(task_id, TaskStatus.PENDING)
                background_tasks.add_task(run_note_task, task_id, video_url, item.platform, data.quality, data.link,
                                          data.screenshot, data.model_name, data.provider_id, data.format, data.style,
                                          data.extras, data.video_understanding, data.video_interval, data.grid_size)
                results.append({
                    "video_url": video_url,
                    "platform": item.platform,
                    "task_id": task_id,
                    "error": None,
                })
            except Exception as item_err:
                # 单条入队失败不中断整批，也不留下无主的 PENDING
                logger.error(f"批量入队单条失败: {item_err}", exc_info=True)
                results.append({
                    "video_url": item.video_url,
                    "platform": item.platform,
                    "task_id": None,
                    "error": str(item_err),
                })
        return R.success(results)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ParseCollectionRequest(BaseModel):
    url: str
    platform: str = "bilibili"


# 解析接口允许的域名白名单：B 站系（含合集/收藏夹主页）+ YouTube
_PARSABLE_HOSTS = {
    "www.bilibili.com", "bilibili.com", "m.bilibili.com",
    "space.bilibili.com", "b23.tv",
    "www.youtube.com", "youtube.com", "youtu.be", "m.youtube.com",
}
# 单次解析的条数上限，防止超大合集长时间占用 worker
MAX_COLLECTION_ITEMS = 200


def _is_parsable_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    return (parsed.netloc or "").lower() in _PARSABLE_HOSTS


@router.post("/parse_collection")
def parse_collection(data: ParseCollectionRequest):
    """把合集/收藏夹/分 P 链接展开为有序视频清单（顺序即合集顺序）。

    用 yt-dlp extract_flat 只取元信息不下载；bilibili 为主（合集/收藏夹/分 P），
    youtube playlist 顺带覆盖。只接受白名单域名的 http(s) 链接。
    """
    if not _is_parsable_url(data.url):
        return R.error(msg="仅支持 B 站（含合集/收藏夹/分 P）与 YouTube 链接的解析", code=400)
    try:
        import yt_dlp
        from app.downloaders.base import YDL_RETRY_OPTS

        ydl_opts = {
            **YDL_RETRY_OPTS,
            'extract_flat': 'in_playlist',
            'quiet': True,
            'skip_download': True,
            'playlistend': MAX_COLLECTION_ITEMS,
            'socket_timeout': 30,
        }
        # B 站合集/收藏夹可能需要登录态，带上既有 cookie 配置（未配置则跳过）
        try:
            from app.downloaders.bilibili_downloader import BilibiliDownloader
            cookiefile = BilibiliDownloader()._cookiefile
            if cookiefile:
                ydl_opts['cookiefile'] = cookiefile
        except Exception:
            pass

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(data.url, download=False)

        items = []
        base_title = (info.get('title') or '') if info else ''
        entries = info.get('entries') if info else None
        if entries:
            for idx, entry in enumerate(entries, start=1):
                if not entry:
                    continue
                url = entry.get('url') or entry.get('webpage_url') or ''
                if url and not url.startswith('http'):
                    # flat entry 只有 id 时按平台拼标准播放页
                    if data.platform == 'youtube':
                        url = f"https://www.youtube.com/watch?v={entry.get('id') or url}"
                    else:
                        url = f"https://www.bilibili.com/video/{entry.get('id') or url}"
                # flat 模式下分 P 常缺独立标题，用合集标题 + 序号兜底
                title = entry.get('title') or (f"{base_title} P{idx}" if base_title else '')
                if url:
                    items.append({"url": url, "title": title})
        elif info and info.get('webpage_url'):
            # 不是 playlist（单视频链接），原样返回一条
            items.append({"url": info['webpage_url'], "title": info.get('title') or ''})
        return R.success(items)
    except Exception as e:
        logger.error(f"解析合集失败: {e}", exc_info=True)
        return R.error(msg=f"解析失败: {e}")


@router.get("/task_status/{task_id}")
def get_task_status(task_id: str):
    status_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.status.json")
    result_path = os.path.join(NOTE_OUTPUT_DIR, f"{task_id}.json")

    # 优先读状态文件
    if os.path.exists(status_path):
        with open(status_path, "r", encoding="utf-8") as f:
            status_content = json.load(f)

        status = status_content.get("status")
        message = status_content.get("message", "")

        if status == TaskStatus.SUCCESS.value:
            # 成功状态的话，继续读取最终笔记内容
            if os.path.exists(result_path):
                with open(result_path, "r", encoding="utf-8") as rf:
                    result_content = json.load(rf)
                return R.success({
                    "status": status,
                    "result": result_content,
                    "message": message,
                    "task_id": task_id
                })
            else:
                # 理论上不会出现，保险处理
                return R.success({
                    "status": TaskStatus.PENDING.value,
                    "message": "任务完成，但结果文件未找到",
                    "task_id": task_id
                })

        if status == TaskStatus.FAILED.value:
            return R.error(message or "任务失败", code=500)

        # 处理中状态
        return R.success({
            "status": status,
            "message": message,
            "task_id": task_id
        })

    # 没有状态文件，但有结果
    if os.path.exists(result_path):
        with open(result_path, "r", encoding="utf-8") as f:
            result_content = json.load(f)
        return R.success({
            "status": TaskStatus.SUCCESS.value,
            "result": result_content,
            "task_id": task_id
        })

    # 什么都没有，默认PENDING
    return R.success({
        "status": TaskStatus.PENDING.value,
        "message": "任务排队中",
        "task_id": task_id
    })


@router.get("/image_proxy")
async def image_proxy(request: Request, url: str):
    headers = {
        "Referer": "https://www.bilibili.com/",
        "User-Agent": request.headers.get("User-Agent", ""),
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=headers)

            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="图片获取失败")

            content_type = resp.headers.get("Content-Type", "image/jpeg")
            return StreamingResponse(
                resp.aiter_bytes(),
                media_type=content_type,
                headers={
                    "Cache-Control": "public, max-age=86400",  #  缓存一天
                    "Content-Type": content_type,
                }
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
