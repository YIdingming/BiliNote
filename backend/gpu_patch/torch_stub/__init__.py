"""torch 替身: 让 BiliNote 的 GPU 判定拿到真实答案（GPU 可选增强，默认无 CUDA 时自动回落 CPU）。

backend/app/services/note.py 的转写器链路用 `import torch; torch.cuda.is_available()`
决定能不能上 GPU; 冻结包里没有 torch, 所以默认永远回落 cpu/int8。
这里补上这一环, 但不无脑返回 True —— 反过来问 ctranslate2 有没有 CUDA 设备、
再逐个试加载所需 DLL, 任何一步不过就返回 False, 让 BiliNote 安全回落 CPU
(它加载 GPU 失败会触发清理 1.4GB 模型缓存的自愈逻辑, 代价太高)。

随包分发: PyInstaller 打包时由 build.bat 以 --add-data 放到 _internal\torch\__init__.py
（PyInstaller onedir 的 sys.path 含 _internal，故可直接被 import）。

启用 GPU 只差 CUDA 运行时 DLL（cublas64_12/cublasLt64_12 + cuDNN 9 全套）：
把它们放进 _internal\ctranslate2\ 或装进系统 PATH 即可，无需改动本文件。
"""

import ctypes
import os
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))   # ...\_internal\torch
_INTERNAL = os.path.dirname(_HERE)                   # ...\_internal
_CT2_DIR = os.path.join(_INTERNAL, "ctranslate2")
_LOG = os.path.join(_HERE, "_probe.log")

# 让 ctranslate2 按名字加载 cublas/cudnn 时能找到: 三种搜索机制都覆盖。
# 句柄必须留住, 被回收就等于撤销了这个目录。
os.environ["PATH"] = _CT2_DIR + os.pathsep + os.environ.get("PATH", "")
try:
    _dll_handle = os.add_dll_directory(_CT2_DIR)
except OSError:
    _dll_handle = None

# 必须能加载的; cuDNN 9 的调度器会按需再加载其余 cudnn_*64_9 子库, 只查存在性
_LOAD = ("cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll")
_EXIST = (
    "cudnn_ops64_9.dll",
    "cudnn_graph64_9.dll",
    "cudnn_heuristic64_9.dll",
    "cudnn_engines_precompiled64_9.dll",
    "cudnn_engines_runtime_compiled64_9.dll",
    "cudnn_cnn64_9.dll",
    "cudnn_adv64_9.dll",
)


def _log(line):
    try:
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write("%s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), line))
    except OSError:
        pass


def _probe():
    for name in _EXIST:
        if not os.path.isfile(os.path.join(_CT2_DIR, name)):
            return False, "缺文件 " + name
    for name in _LOAD:
        try:
            ctypes.WinDLL(os.path.join(_CT2_DIR, name))
        except OSError as e:
            return False, "%s 加载失败: %r" % (name, e)
    try:
        import ctranslate2
        count = ctranslate2.get_cuda_device_count()
    except Exception as e:
        return False, "ctranslate2 探测失败: %r" % (e,)
    if count <= 0:
        return False, "ctranslate2 看不到 CUDA 设备"
    return True, "CUDA 设备 %d 个, 依赖齐全" % count


def _last_verdict():
    """日志里最后一条判定。前端会隔十几秒轮询转写器状态, 每次都问一次 GPU,
    不做去重的话日志会被刷爆。"""
    try:
        with open(_LOG, "r", encoding="utf-8") as f:
            for line in reversed(f.readlines()):
                if "cuda.is_available() ->" in line:
                    return "-> True" in line
    except Exception:
        pass
    return None


class _Cuda:
    @staticmethod
    def is_available():
        ok, why = _probe()
        if _last_verdict() is not ok:   # 只在结论与上次不同时落一行
            _log("cuda.is_available() -> %s (%s)" % (ok, why))
        return ok


cuda = _Cuda()

_log(
    "import torch 生效 | frozen=%r | MEIPASS=%r | adder=%r | sys.path[:4]=%r"
    % (getattr(sys, "frozen", None), getattr(sys, "_MEIPASS", None),
       _dll_handle is not None, sys.path[:4])
)
