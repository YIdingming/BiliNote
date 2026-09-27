import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Github, ExternalLink, Download, Layers, Zap, Wrench } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area.tsx'
import logo from '@/assets/icon.svg'

const UPSTREAM_REPO = 'https://github.com/JefferyHcool/BiliNote'
const FORK_REPO = 'https://github.com/YIdingming/BiliNote'

export default function AboutPage() {
  const appVersion = __APP_VERSION__
  return (
    <ScrollArea className={'h-full overflow-y-auto bg-white'}>
      <div className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="mb-16 flex flex-col items-center justify-center text-center">
          <div className="mb-4 flex items-center gap-4">
            <img
              src={logo}
              alt="BiliNote Logo"
              width={50}
              height={50}
              className="rounded-lg"
            />
            <h1 className="text-4xl font-bold">BiliNote v{appVersion}</h1>
          </div>
          <p className="text-muted-foreground mb-2 text-xl italic">
            AI 视频笔记生成工具 让 AI 为你的视频做笔记
          </p>
          <p className="mb-6 text-sm text-neutral-400">
            本版本为社区增强 fork，基于上游开源项目构建
          </p>

          <div className="mb-8 flex flex-wrap justify-center gap-2">
            <Badge variant="secondary">MIT License</Badge>
            <Badge variant="secondary">React</Badge>
            <Badge variant="secondary">FastAPI</Badge>
            <Badge variant="secondary">批量笔记</Badge>
            <Badge variant="secondary">GPU 可选</Badge>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild>
              <a href={FORK_REPO} target="_blank">
                <Github className="mr-2 h-4 w-4" />
                本 Fork 仓库
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`${FORK_REPO}/releases`} target="_blank">
                <Download className="mr-2 h-4 w-4" />
                下载桌面版
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={UPSTREAM_REPO} target="_blank">
                <ExternalLink className="mr-2 h-4 w-4" />
                上游项目
              </a>
            </Button>
          </div>
        </div>

        {/* Project Introduction */}
        <section className="mb-16">
          <h2 className="mb-6 text-center text-3xl font-bold">✨ 项目简介</h2>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-lg">
              BiliNote 是一个开源的 AI 视频笔记助手，支持通过哔哩哔哩、YouTube、抖音等视频链接，
              自动提取内容并生成结构清晰、重点明确的 Markdown
              格式笔记。支持插入截图、原片跳转等功能。
            </p>
          </div>
        </section>

        {/* Fork Enhancements */}
        <section className="mb-16">
          <h2 className="mb-8 text-center text-3xl font-bold">🔱 本 Fork 的增强</h2>
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="h-full">
              <CardContent className="pt-4">
                <Layers className="mb-3 h-8 w-8 text-primary" />
                <h3 className="mb-2 text-xl font-semibold">批量笔记</h3>
                <p className="text-muted-foreground">
                  粘贴链接清单（支持 B 站合集/收藏夹/分 P 一键展开），批量生成后在生成历史中以批次卡片管理，右侧宽栏查看进度与逐条笔记。
                </p>
              </CardContent>
            </Card>
            <Card className="h-full">
              <CardContent className="pt-4">
                <Download className="mb-3 h-8 w-8 text-primary" />
                <h3 className="mb-2 text-xl font-semibold">批量导出</h3>
                <p className="text-muted-foreground">
                  一键打包笔记 Markdown、转写原文 txt（可选时间戳）、思维导图 xmind，或合并为带目录的合集文档；单条笔记也支持导出原文。
                </p>
              </CardContent>
            </Card>
            <Card className="h-full">
              <CardContent className="pt-4">
                <Zap className="mb-3 h-8 w-8 text-primary" />
                <h3 className="mb-2 text-xl font-semibold">GPU 可选加速</h3>
                <p className="text-muted-foreground">
                  内置 GPU 自适应探测，默认 CPU 运行；具备 CUDA 运行环境时自动启用 GPU 转写，速度提升数倍，无需任何配置。
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="mx-auto mt-6 max-w-4xl">
            <Card>
              <CardContent className="flex items-start gap-3 pt-4">
                <Wrench className="mt-1 h-5 w-5 shrink-0 text-neutral-400" />
                <p className="text-muted-foreground text-sm">
                  同时修复了上游下载链路缺陷（已有字幕时误触完整视频下载）与转写/总结阶段进度显示不更新的问题。
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Features Section */}
        <section className="mb-16">
          <h2 className="mb-8 text-center text-3xl font-bold">🔧 功能特性</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              { title: '多平台支持', desc: '支持 Bilibili、YouTube、本地视频、抖音等多个平台' },
              { title: '批量笔记', desc: '链接清单批量生成，批次化管理与进度追踪' },
              { title: '合集解析', desc: 'B 站合集/收藏夹/分 P 链接一键展开为生成清单' },
              { title: '笔记格式选择', desc: '支持返回多种笔记格式，满足不同需求' },
              { title: '笔记风格选择', desc: '支持多种笔记风格，个性化定制' },
              { title: '多模态视频理解', desc: '结合视觉和音频内容，全面理解视频' },
              { title: '自定义 GPT 配置', desc: '支持自行配置 GPT 大模型' },
              { title: '本地音频转写', desc: '支持 Fast-Whisper 等本地模型音频转写' },
              { title: '结构化笔记', desc: '自动生成结构化 Markdown 笔记' },
            ].map((feature, index) => (
              <Card key={index} className="h-full">
                <CardContent className="pt-2">
                  <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Upstream Acknowledgement */}
        <section className="mb-16">
          <h2 className="mb-6 text-center text-3xl font-bold">🙏 致谢</h2>
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-muted-foreground text-lg">
              本项目基于{' '}
              <a
                href={UPSTREAM_REPO}
                target="_blank"
                className="text-primary hover:underline"
              >
                JefferyHcool/BiliNote
              </a>{' '}
              （MIT License）构建，感谢原作者与社区贡献者的优秀工作。
              <br />
              <span className="text-sm">
                上游的更新可通过 GitHub 同步到本 fork；使用问题请优先在上游文档与社区查找答案。
              </span>
            </p>
          </div>
        </section>

        {/* License Section */}
        <section className="mb-8 text-center">
          <h2 className="mb-4 text-3xl font-bold">📜 License</h2>
          <p>
            MIT License · Copyright (c) 2024 Jeffery Huang（上游）· fork 改动部分同样以 MIT 协议开放
          </p>
        </section>
      </div>
    </ScrollArea>
  )
}
