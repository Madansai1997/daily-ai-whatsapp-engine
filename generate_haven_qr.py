"""
Generates high-resolution QR code and printable gift cards for Shalini's Haven Birthday App.
"""
import os
import qrcode
from PIL import Image, ImageDraw, ImageFont

def generate_qr(target_url="https://shalini-haven.vercel.app", output_path="haven_qr_code.png"):
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=16,
        border=3,
    )
    qr.add_data(target_url)
    qr.make(fit=True)

    # Base QR Image in dark/gold palette
    qr_img = qr.make_image(fill_color="#0b0f19", back_color="#ffffff").convert("RGBA")
    
    # Save direct QR PNG
    qr_img.save(output_path)
    print(f"✅ Generated direct QR Code: {output_path}")

    # Generate a beautiful printable Gift Card
    card_width = 900
    card_height = 1250
    card = Image.new("RGBA", (card_width, card_height), "#080b11")
    draw = ImageDraw.Draw(card)

    # Subtle golden border
    draw.rounded_rectangle(
        [(40, 40), (card_width - 40, card_height - 40)],
        radius=36,
        outline="#fbbf24",
        width=3
    )

    # Inner decorative border
    draw.rounded_rectangle(
        [(55, 55), (card_width - 55, card_height - 55)],
        radius=28,
        outline="#d97706",
        width=1
    )

    # Place QR code in center
    qr_resized = qr_img.resize((500, 500), Image.Resampling.LANCZOS)
    # Background plate for QR
    qr_x = (card_width - 500) // 2
    qr_y = 380
    
    # White rounded plate behind QR for ultra-crisp phone camera scanning
    draw.rounded_rectangle(
        [(qr_x - 16, qr_y - 16), (qr_x + 500 + 16, qr_y + 500 + 16)],
        radius=24,
        fill="#ffffff",
        outline="#fbbf24",
        width=2
    )
    card.paste(qr_resized, (qr_x, qr_y), qr_resized)

    # Save styled gift card
    card_output = "haven_gift_card.png"
    card.save(card_output)
    print(f"✅ Generated printable Gift Card: {card_output}")

if __name__ == "__main__":
    url = os.environ.get("HAVEN_URL", "https://shalini-haven.vercel.app")
    generate_qr(target_url=url)
