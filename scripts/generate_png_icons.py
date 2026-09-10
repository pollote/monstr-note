import os
from PIL import Image, ImageDraw

def create_firefox_notes_icon(size):
    # Create high-res image and downscale for antialiasing
    scale = 4
    img_size = size * scale
    img = Image.new("RGBA", (img_size, img_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Background gradient circle (Fox orange to deep magenta)
    for r in range(img_size // 2, 0, -1):
        t = r / (img_size // 2)
        # Interpolate color: Orange (255, 80, 0) to Purple (144, 89, 255)
        red = int(255 * t + 144 * (1 - t))
        green = int(80 * t + 89 * (1 - t))
        blue = int(0 * t + 255 * (1 - t))
        center = img_size // 2
        draw.ellipse([center - r, center - r, center + r, center + r], fill=(red, green, blue, 255))

    # White note pad sheet
    margin = int(img_size * 0.25)
    pad_box = [margin, margin - int(img_size * 0.05), img_size - margin, img_size - margin + int(img_size * 0.05)]
    draw.rounded_rectangle(pad_box, radius=int(img_size * 0.08), fill=(255, 255, 255, 245))

    # Note lines
    line_x1 = margin + int(img_size * 0.1)
    line_x2 = img_size - margin - int(img_size * 0.1)
    line_y1 = margin + int(img_size * 0.12)
    line_y2 = margin + int(img_size * 0.24)
    line_y3 = margin + int(img_size * 0.36)

    line_w = max(2, int(img_size * 0.04))
    draw.line([line_x1, line_y1, line_x2, line_y1], fill=(255, 80, 0, 255), width=line_w)
    draw.line([line_x1, line_y2, line_x2 - int(img_size * 0.1), line_y2], fill=(43, 42, 51, 255), width=line_w)
    draw.line([line_x1, line_y3, line_x2 - int(img_size * 0.18), line_y3], fill=(43, 42, 51, 255), width=line_w)

    # Lock badge (Purple circle at bottom right)
    lock_center_x = int(img_size * 0.72)
    lock_center_y = int(img_size * 0.72)
    lock_r = int(img_size * 0.18)
    draw.ellipse([lock_center_x - lock_r, lock_center_y - lock_r, lock_center_x + lock_r, lock_center_y + lock_r], fill=(144, 89, 255, 255))

    # Lock shackle & body
    lock_body = [lock_center_x - int(lock_r * 0.4), lock_center_y, lock_center_x + int(lock_r * 0.4), lock_center_y + int(lock_r * 0.5)]
    draw.rectangle(lock_body, fill=(255, 255, 255, 255))
    shackle = [lock_center_x - int(lock_r * 0.3), lock_center_y - int(lock_r * 0.4), lock_center_x + int(lock_r * 0.3), lock_center_y]
    draw.arc(shackle, start=180, end=0, fill=(255, 255, 255, 255), width=max(2, int(img_size * 0.03)))

    # Downscale for crisp antialiasing
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

icon_dir = os.path.abspath("icons")
os.makedirs(icon_dir, exist_ok=True)

for s in [16, 32, 48, 128]:
    icon = create_firefox_notes_icon(s)
    icon.save(os.path.join(icon_dir, f"icon-{s}.png"))
    print(f"Saved icon-{s}.png")
