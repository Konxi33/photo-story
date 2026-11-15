# 生成应用图标：深色圆角方块 + 一页照片 + 暖色光点
from PIL import Image, ImageDraw

S = 1024


def rounded(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 底板：深墨色圆角方块
rounded(d, (48, 48, S - 48, S - 48), 220, (23, 23, 26, 255))

# 页面：米白色圆角矩形（略向右上偏移，形成层次）
page = (250, 218, S - 236, S - 250)
rounded(d, page, 84, (251, 250, 247, 255))

# 页面里的一张“照片”：暖灰底 + 暖色圆点（太阳）
photo = (330, 292, S - 320, 566)
rounded(d, photo, 40, (232, 226, 214, 255))
d.ellipse((photo[2] - 150, photo[1] + 46, photo[2] - 46, photo[1] + 150), fill=(196, 138, 74, 255))

# 照片下沿的两条文字线
d.rounded_rectangle((330, 636, S - 430, 676), radius=20, fill=(60, 60, 66, 255))
d.rounded_rectangle((330, 716, S - 560, 748), radius=16, fill=(150, 148, 142, 255))

img.save("build/icon.png")

sizes = [256, 128, 64, 48, 32, 16]
img.save("build/icon.ico", sizes=[(s, s) for s in sizes])
print("icon.ico 生成完成：", sizes)
