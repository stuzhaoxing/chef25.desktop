# dmgbuild 配置：在 CI(GitHub Actions macos runner) 里生成带背景+图标布局的安装 DMG。
#
# 为什么不用 Tauri 自带的 DMG:
#   Tauri 打 DMG 靠 osascript 驱动 Finder 写 .DS_Store(窗口大小/背景图/图标位置)。
#   无头 CI runner 没权限用 Apple Events 控制 Finder(TCC 拒绝)→ 这步静默失败 →
#   背景图塞进去了但没有 .DS_Store 去引用它 → 用户双击看到的是默认的大裸窗口。
#   dmgbuild 纯 Python 直接写 .DS_Store,不碰 Finder,适合无头构建环境。
#
# 坐标/尺寸与 tauri.conf.json > bundle.macOS.dmg 保持一致(那份配置现仅本机构建生效)。
# 背景 background.png 为 1360x920 @144dpi(= 680x460 点),Finder 按 DPI 缩放,retina 清晰。
#
# 用法(见 .github/workflows/release.yml):
#   dmgbuild -s dmgbuild.py -D app=<.app 路径> -D background=<png> -D icon=<icns> "25小厨" out.dmg

import os.path

app = defines["app"]
background_img = defines["background"]
volicon = defines.get("icon", "")

app_name = os.path.basename(app)  # "25小厨.app"

# ---- 卷 ----
format = "UDZO"            # 压缩只读,与 Tauri 产物一致
compression_level = 9

files = [app]
symlinks = {"Applications": "/Applications"}
if volicon:
    icon = volicon        # 卷图标(.VolumeIcon.icns)

# ---- 窗口 / 图标视图 ----
background = background_img
window_rect = ((200, 200), (680, 460))  # ((屏幕x, 屏幕y), (宽, 高))
default_view = "icon-view"
show_icon_preview = False
include_icon_view_settings = True
include_list_view_settings = False
arrange_by = None
label_pos = "bottom"
text_size = 12
icon_size = 128

icon_locations = {
    app_name: (200, 205),      # 左:拖动源
    "Applications": (480, 205),  # 右:应用程序文件夹
}
