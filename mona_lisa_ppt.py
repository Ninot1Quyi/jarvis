#!/usr/bin/env python3
"""
Mona Lisa in PowerPoint - 代码实现
使用python-pptx库在PPT中绘制蒙娜丽莎
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
import math
import os

# 蒙娜丽莎的调色板 (基于达芬奇色调)
COLORS = {
    'dark_brown': (62, 44, 37),      # 深棕色 - 头发/阴影
    'medium_brown': (120, 85, 60),   # 中棕色 - 皮肤阴影
    'skin_tone': (199, 155, 115),    # 肤色
    'light_skin': (220, 185, 150),   # 浅肤色
    'dark': (50, 40, 35),            # 深色 - 眼睛
    'green_dark': (85, 95, 80),      # 暗绿色 - 背景
    'green_medium': (100, 115, 90),  # 中绿色
    'green_light': (130, 145, 115),  # 浅绿色
    'gold': (180, 150, 100),         # 金色 - 装饰
    'cream': (240, 235, 220),         # 奶油色
    'black': (30, 25, 20),           # 黑色
    'shadow': (80, 65, 55),          # 阴影色
}

def create_mona_lisa():
    """创建蒙娜丽莎PPT"""
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(14)
    
    # 添加空白幻灯片
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    
    # 背景 - 绿色拱形背景
    background = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(1), Inches(0.5),
        Inches(8), Inches(13)
    )
    background.fill.solid()
    background.fill.fore_color.rgb = RGBColor(*COLORS['green_dark'])
    background.line.fill.background()
    
    # 内层背景
    inner_bg = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(1.3), Inches(0.8),
        Inches(7.4), Inches(12.4)
    )
    inner_bg.fill.solid()
    inner_bg.fill.fore_color.rgb = RGBColor(*COLORS['green_light'])
    inner_bg.line.fill.background()
    
    # 画框装饰
    frame = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(1.5), Inches(1),
        Inches(7), Inches(12)
    )
    frame.fill.solid()
    frame.fill.fore_color.rgb = RGBColor(*COLORS['gold'])
    frame.line.fill.background()
    
    inner_frame = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(1.7), Inches(1.2),
        Inches(6.6), Inches(11.6)
    )
    inner_frame.fill.solid()
    inner_frame.fill.fore_color.rgb = RGBColor(*COLORS['cream'])
    inner_frame.line.fill.background()
    
    # ========== 绘制蒙娜丽莎面部 ==========
    # 脸部轮廓 (椭圆形)
    face = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(3.8), Inches(2.5),
        Inches(2.8), Inches(3.8)
    )
    face.fill.solid()
    face.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    face.line.fill.background()
    
    # 前额
    forehead = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.1), Inches(2.2),
        Inches(2.2), Inches(1.8)
    )
    forehead.fill.solid()
    forehead.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    forehead.line.fill.background()
    
    # 下巴
    chin = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.3), Inches(5.5),
        Inches(1.8), Inches(1.2)
    )
    chin.fill.solid()
    chin.fill.fore_color.rgb = RGBColor(*COLORS['light_skin'])
    chin.line.fill.background()
    
    # 头发 - 黑色卷发效果
    hair_positions = [
        (3.2, 1.8, 1.0, 1.5),
        (6.2, 1.8, 1.0, 1.5),
        (3.0, 2.5, 1.5, 3.0),
        (6.0, 2.5, 1.5, 3.0),
        (2.8, 4.0, 1.8, 4.0),
        (6.0, 4.0, 1.8, 4.0),
        (3.0, 6.5, 2.0, 2.5),
    ]
    
    for x, y, w, h in hair_positions:
        hair = slide.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(x), Inches(y),
            Inches(w), Inches(h)
        )
        hair.fill.solid()
        hair.fill.fore_color.rgb = RGBColor(*COLORS['dark_brown'])
        hair.line.fill.background()
    
    # 发髻/卷发装饰
    curls = [
        (2.5, 3.5, 0.8, 0.8),
        (7.1, 3.5, 0.8, 0.8),
        (2.3, 4.5, 1.0, 1.0),
        (7.2, 4.5, 1.0, 1.0),
        (2.5, 5.5, 0.7, 0.7),
        (7.3, 5.5, 0.7, 0.7),
    ]
    for x, y, w, h in curls:
        curl = slide.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(x), Inches(y),
            Inches(w), Inches(h)
        )
        curl.fill.solid()
        curl.fill.fore_color.rgb = RGBColor(*COLORS['dark'])
        curl.line.fill.background()
    
    # 头巾/纱丽效果
    veil = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(2.8), Inches(1.8),
        Inches(4.8), Inches(1.0)
    )
    veil.fill.solid()
    veil.fill.fore_color.rgb = RGBColor(*COLORS['dark'])
    veil.line.fill.background()
    
    # 眼睛区域
    # 左眼
    left_eye_white = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.2), Inches(3.5),
        Inches(0.6), Inches(0.3)
    )
    left_eye_white.fill.solid()
    left_eye_white.fill.fore_color.rgb = RGBColor(*COLORS['cream'])
    left_eye_white.line.fill.background()
    
    left_eye_pupil = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.35), Inches(3.55),
        Inches(0.3), Inches(0.25)
    )
    left_eye_pupil.fill.solid()
    left_eye_pupil.fill.fore_color.rgb = RGBColor(*COLORS['dark'])
    left_eye_pupil.line.fill.background()
    
    # 右眼
    right_eye_white = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(5.6), Inches(3.5),
        Inches(0.6), Inches(0.3)
    )
    right_eye_white.fill.solid()
    right_eye_white.fill.fore_color.rgb = RGBColor(*COLORS['cream'])
    right_eye_white.line.fill.background()
    
    right_eye_pupil = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(5.75), Inches(3.55),
        Inches(0.3), Inches(0.25)
    )
    right_eye_pupil.fill.solid()
    right_eye_pupil.fill.fore_color.rgb = RGBColor(*COLORS['dark'])
    right_eye_pupil.line.fill.background()
    
    # 眉毛
    left_brow = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.1), Inches(3.3),
        Inches(0.8), Inches(0.1)
    )
    left_brow.fill.solid()
    left_brow.fill.fore_color.rgb = RGBColor(*COLORS['dark_brown'])
    left_brow.line.fill.background()
    
    right_brow = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(5.5), Inches(3.3),
        Inches(0.8), Inches(0.1)
    )
    right_brow.fill.solid()
    right_brow.fill.fore_color.rgb = RGBColor(*COLORS['dark_brown'])
    right_brow.line.fill.background()
    
    # 鼻子
    nose = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.9), Inches(3.9),
        Inches(0.5), Inches(0.8)
    )
    nose.fill.solid()
    nose.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    nose.line.fill.background()
    
    # 阴影 - 鼻子阴影
    nose_shadow = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.75), Inches(4.2),
        Inches(0.3), Inches(0.5)
    )
    nose_shadow.fill.solid()
    nose_shadow.fill.fore_color.rgb = RGBColor(*COLORS['medium_brown'])
    nose_shadow.line.fill.background()
    
    # 嘴巴 - 神秘的微笑
    lips = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.6), Inches(4.8),
        Inches(1.2), Inches(0.3)
    )
    lips.fill.solid()
    lips.fill.fore_color.rgb = RGBColor(*COLORS['medium_brown'])
    lips.line.fill.background()
    
    # 上唇
    upper_lip = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(4.7), Inches(4.7),
        Inches(1.0), Inches(0.2)
    )
    upper_lip.fill.solid()
    upper_lip.fill.fore_color.rgb = RGBColor(*COLORS['shadow'])
    upper_lip.line.fill.background()
    
    # 颈部
    neck = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.7), Inches(5.8),
        Inches(1.0), Inches(1.5)
    )
    neck.fill.solid()
    neck.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    neck.line.fill.background()
    
    # 颈部阴影
    neck_shadow = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.7), Inches(6.0),
        Inches(0.3), Inches(1.2)
    )
    neck_shadow.fill.solid()
    neck_shadow.fill.fore_color.rgb = RGBColor(*COLORS['shadow'])
    neck_shadow.line.fill.background()
    
    # 锁骨
    collar = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.0), Inches(7.2),
        Inches(2.4), Inches(0.8)
    )
    collar.fill.solid()
    collar.fill.fore_color.rgb = RGBColor(*COLORS['cream'])
    collar.line.fill.background()
    
    # 衣服/长袍
    robe = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(3.0), Inches(7.5),
        Inches(4.4), Inches(5.0)
    )
    robe.fill.solid()
    robe.fill.fore_color.rgb = RGBColor(*COLORS['dark'])
    robe.line.fill.background()
    
    # 衣服褶皱
    folds = [
        (3.5, 8.0, 0.3, 4.0),
        (4.5, 8.0, 0.2, 4.0),
        (5.5, 8.0, 0.2, 4.0),
        (6.5, 8.0, 0.3, 4.0),
    ]
    for x, y, w, h in folds:
        fold = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(x), Inches(y),
            Inches(w), Inches(h)
        )
        fold.fill.solid()
        fold.fill.fore_color.rgb = RGBColor(*COLORS['dark_brown'])
        fold.line.fill.background()
    
    # 手臂/手部 (双手交叠)
    # 左臂
    left_arm = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(3.2), Inches(7.8),
        Inches(2.5), Inches(0.8)
    )
    left_arm.fill.solid()
    left_arm.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    left_arm.line.fill.background()
    
    # 右臂
    right_arm = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.8), Inches(8.0),
        Inches(2.5), Inches(0.8)
    )
    right_arm.fill.solid()
    right_arm.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    right_arm.line.fill.background()
    
    # 左手
    left_hand = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(3.0), Inches(8.2),
        Inches(1.2), Inches(0.9)
    )
    left_hand.fill.solid()
    left_hand.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    left_hand.line.fill.background()
    
    # 右手
    right_hand = slide.shapes.add_shape(
        MSO_SHAPE.OVAL,
        Inches(6.2), Inches(8.3),
        Inches(1.2), Inches(0.9)
    )
    right_hand.fill.solid()
    right_hand.fill.fore_color.rgb = RGBColor(*COLORS['skin_tone'])
    right_hand.line.fill.background()
    
    # 手指细节
    fingers = [
        (6.3, 8.4, 0.15, 0.6),
        (6.5, 8.5, 0.15, 0.6),
        (6.7, 8.5, 0.15, 0.6),
        (6.9, 8.4, 0.15, 0.5),
    ]
    for x, y, w, h in fingers:
        finger = slide.shapes.add_shape(
            MSO_SHAPE.ROUNDED_RECTANGLE,
            Inches(x), Inches(y),
            Inches(w), Inches(h)
        )
        finger.fill.solid()
        finger.fill.fore_color.rgb = RGBColor(*COLORS['light_skin'])
        finger.line.fill.background()
    
    # 背景装饰 - 山脉
    mountain1 = slide.shapes.add_shape(
        MSO_SHAPE.ISOSCELES_TRIANGLE,
        Inches(2.0), Inches(10.5),
        Inches(2.0), Inches(2.0)
    )
    mountain1.fill.solid()
    mountain1.fill.fore_color.rgb = RGBColor(*COLORS['green_medium'])
    mountain1.line.fill.background()
    
    mountain2 = slide.shapes.add_shape(
        MSO_SHAPE.ISOSCELES_TRIANGLE,
        Inches(3.5), Inches(10.8),
        Inches(2.5), Inches(1.7)
    )
    mountain2.fill.solid()
    mountain2.fill.fore_color.rgb = RGBColor(*COLORS['green_dark'])
    mountain2.line.fill.background()
    
    mountain3 = slide.shapes.add_shape(
        MSO_SHAPE.ISOSCELES_TRIANGLE,
        Inches(5.8), Inches(10.5),
        Inches(2.0), Inches(2.0)
    )
    mountain3.fill.solid()
    mountain3.fill.fore_color.rgb = RGBColor(*COLORS['green_medium'])
    mountain3.line.fill.background()
    
    # 背景装饰 - 道路/地面
    road = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        Inches(4.0), Inches(11.5),
        Inches(2.5), Inches(0.8)
    )
    road.fill.solid()
    road.fill.fore_color.rgb = RGBColor(*COLORS['green_dark'])
    road.line.fill.background()
    
    # 添加标题
    title_box = slide.shapes.add_textbox(Inches(2.5), Inches(12.5), Inches(5), Inches(0.5))
    title_frame = title_box.text_frame
    title_para = title_frame.paragraphs[0]
    title_para.text = "Mona Lisa - 蒙娜丽莎"
    title_para.font.size = Pt(18)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(*COLORS['dark'])
    title_para.alignment = 1
    
    # 添加副标题
    subtitle_box = slide.shapes.add_textbox(Inches(2.5), Inches(13.0), Inches(5), Inches(0.4))
    subtitle_frame = subtitle_box.text_frame
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.text = "PowerPoint Art by Code"
    subtitle_para.font.size = Pt(12)
    subtitle_para.font.italic = True
    subtitle_para.font.color.rgb = RGBColor(*COLORS['medium_brown'])
    subtitle_para.alignment = 1
    
    # 保存文件
    output_path = "mona_lisa.pptx"
    prs.save(output_path)
    print(f"蒙娜丽莎PPT已创建: {os.path.abspath(output_path)}")
    return output_path


def create_pixel_art_mona_lisa():
    """创建像素艺术风格的蒙娜丽莎"""
    prs = Presentation()
    prs.slide_width = Inches(8)
    prs.slide_height = Inches(11)
    
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    
    # 背景
    bg = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE,
        Inches(0), Inches(0),
        Inches(8), Inches(11)
    )
    bg.fill.solid()
    bg.fill.fore_color.rgb = RGBColor(*COLORS['cream'])
    bg.line.fill.background()
    
    # 像素艺术 - 简化的蒙娜丽莎轮廓
    # 定义一个简化的蒙娜丽莎像素图
    pixels = []
    
    # 头发和头部轮廓 (使用点)
    head_dots = [
        # 头发区域 - 深棕色
        (3.0, 1.5, COLORS['dark_brown']),
        (3.2, 1.5, COLORS['dark_brown']),
        (3.4, 1.5, COLORS['dark_brown']),
        (3.6, 1.5, COLORS['dark_brown']),
        (3.8, 1.5, COLORS['dark_brown']),
        (4.0, 1.5, COLORS['dark_brown']),
        (4.2, 1.5, COLORS['dark_brown']),
        (4.4, 1.5, COLORS['dark_brown']),
        (4.6, 1.5, COLORS['dark_brown']),
        (4.8, 1.5, COLORS['dark_brown']),
        # 左侧头发
        (2.8, 1.7, COLORS['dark_brown']),
        (2.6, 1.9, COLORS['dark_brown']),
        (2.5, 2.1, COLORS['dark_brown']),
        (2.4, 2.3, COLORS['dark_brown']),
        (2.3, 2.5, COLORS['dark_brown']),
        (2.3, 2.7, COLORS['dark_brown']),
        (2.3, 2.9, COLORS['dark_brown']),
        (2.3, 3.1, COLORS['dark_brown']),
        (2.4, 3.3, COLORS['dark_brown']),
        (2.5, 3.5, COLORS['dark_brown']),
        (2.6, 3.7, COLORS['dark_brown']),
        # 右侧头发
        (5.0, 1.7, COLORS['dark_brown']),
        (5.2, 1.9, COLORS['dark_brown']),
        (5.3, 2.1, COLORS['dark_brown']),
        (5.4, 2.3, COLORS['dark_brown']),
        (5.5, 2.5, COLORS['dark_brown']),
        (5.5, 2.7, COLORS['dark_brown']),
        (5.5, 2.9, COLORS['dark_brown']),
        (5.5, 3.1, COLORS['dark_brown']),
        (5.4, 3.3, COLORS['dark_brown']),
        (5.3, 3.5, COLORS['dark_brown']),
        (5.2, 3.7, COLORS['dark_brown']),
    ]
    
    # 脸部 - 肤色
    face_dots = []
    for y in range(16, 35):
        for x in range(28, 52):
            # 椭圆形脸
            dx = (x - 40) / 12
            dy = (y - 25) / 10
            if dx*dx + dy*dy <= 1:
                # 渐变肤色
                if y < 22:
                    face_dots.append((x * 0.12, y * 0.12, COLORS['light_skin']))
                elif y < 28:
                    face_dots.append((x * 0.12, y * 0.12, COLORS['skin_tone']))
                else:
                    face_dots.append((x * 0.12, y * 0.12, COLORS['medium_brown']))
    
    # 眼睛
    eyes = [
        # 左眼
        (3.5, 2.0, COLORS['cream']),  # 眼白
        (3.6, 2.05, COLORS['dark']),   # 瞳孔
        (3.55, 1.95, COLORS['dark_brown']),  # 眉毛
        # 右眼
        (4.2, 2.0, COLORS['cream']),
        (4.3, 2.05, COLORS['dark']),
        (4.25, 1.95, COLORS['dark_brown']),
    ]
    
    # 鼻子 (鼻子阴影)
    nose_dots = [
        (3.9, 2.3, COLORS['medium_brown']),
        (3.85, 2.4, COLORS['medium_brown']),
        (3.9, 2.5, COLORS['medium_brown']),
    ]
    
    # 神秘微笑
    smile_dots = [
        (3.7, 2.8, COLORS['shadow']),
        (3.8, 2.85, COLORS['shadow']),
        (3.9, 2.87, COLORS['medium_brown']),
        (4.0, 2.88, COLORS['medium_brown']),
        (4.1, 2.87, COLORS['shadow']),
        (4.2, 2.85, COLORS['shadow']),
        (4.3, 2.8, COLORS['shadow']),
    ]
    
    # 颈部
    neck_dots = []
    for y in range(35, 42):
        for x in range(35, 45):
            neck_dots.append((x * 0.12, y * 0.12, COLORS['skin_tone']))
    
    # 长袍/衣服
    robe_dots = []
    for y in range(42, 80):
        for x in range(25, 55):
            # 梯形衣服
            if y < 50:
                expected_width = 15 - (y - 42)
                if abs(x - 40) <= expected_width:
                    robe_dots.append((x * 0.12, y * 0.12, COLORS['dark']))
            else:
                if 25 <= x <= 55:
                    robe_dots.append((x * 0.12, y * 0.12, COLORS['dark']))
    
    # 合并所有点
    all_dots = head_dots + face_dots + eyes + nose_dots + smile_dots + neck_dots + robe_dots
    
    # 绘制所有点
    for x, y, color in all_dots:
        dot = slide.shapes.add_shape(
            MSO_SHAPE.OVAL,
            Inches(x), Inches(y),
            Inches(0.08), Inches(0.08)
        )
        dot.fill.solid()
        dot.fill.fore_color.rgb = RGBColor(*color)
        dot.line.fill.background()
    
    # 添加标题
    title_box = slide.shapes.add_textbox(Inches(2), Inches(9.5), Inches(4), Inches(0.5))
    title_frame = title_box.text_frame
    title_para = title_frame.paragraphs[0]
    title_para.text = "像素艺术风格蒙娜丽莎"
    title_para.font.size = Pt(14)
    title_para.font.color.rgb = RGBColor(*COLORS['dark'])
    title_para.alignment = 1
    
    # 保存
    output_path = "mona_lisa_pixel.pptx"
    prs.save(output_path)
    print(f"像素风格蒙娜丽莎PPT已创建: {os.path.abspath(output_path)}")
    return output_path


if __name__ == "__main__":
    print("🎨 开始生成蒙娜丽莎PPT...")
    print("-" * 40)
    
    # 创建主版本
    file1 = create_mona_lisa()
    
    # 创建像素艺术版本
    file2 = create_pixel_art_mona_lisa()
    
    print("-" * 40)
    print("✅ 完成！已生成两个PPT文件：")
    print(f"   1. {file1} - 形状组合版")
    print(f"   2. {file2} - 像素艺术版")
    print("\n💡 提示：用 PowerPoint 或 Keynote 打开查看效果！")
