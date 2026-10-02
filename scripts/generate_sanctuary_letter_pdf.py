import os
import qrcode
from PIL import Image
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as RLImage, Table, TableStyle, HRFlowable

def generate_qr_image(target_url="https://sanctuary-shalini.vercel.app", out_path="sanctuary_qr.png"):
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=10,
        border=2,
    )
    qr.add_data(target_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F172A", back_color="#FFFFFF")
    img.save(out_path)
    return out_path

def build_letter_pdf(filename="Shalini_28th_Birthday_Sanctuary_Letter.pdf", app_url="https://sanctuary-shalini.vercel.app"):
    qr_path = "sanctuary_qr.png"
    generate_qr_image(app_url, qr_path)

    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=64,
        rightMargin=64,
        topMargin=64,
        bottomMargin=64
    )

    styles = getSampleStyleSheet()

    c_primary = colors.HexColor("#0F172A")
    c_accent = colors.HexColor("#D97706")   # Warm Amber
    c_text = colors.HexColor("#334155")
    c_muted = colors.HexColor("#64748B")

    title_style = ParagraphStyle(
        'LetterTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=25,
        textColor=c_primary,
        spaceAfter=12
    )

    body_style = ParagraphStyle(
        'LetterBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10.5,
        leading=17,
        textColor=c_text,
        spaceAfter=12
    )

    body_bold = ParagraphStyle(
        'LetterBodyBold',
        parent=body_style,
        fontName='Helvetica-Bold',
        textColor=c_primary
    )

    story = []

    story.append(Paragraph("Happy 28th Birthday, Shalini.", title_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=0, spaceAfter=16))

    story.append(Paragraph(
        "I know life has had a lot of noise, responsibilities, and weight lately. "
        "There are always deadlines to meet, expectations to manage, and a world that constantly asks you to hurry up.",
        body_style
    ))

    story.append(Paragraph(
        "This year, I don't want you to feel the need to rush, prove anything to the world, or carry everything all at once. "
        "Give yourself total, unapologetic permission to just breathe, take things slow, and walk at your own natural pace.",
        body_style
    ))

    story.append(Paragraph(
        "At the bottom of this note is a private sanctuary built dedicated only for you. "
        "There are no deadlines, no social expectations, and no need to reply to anything. "
        "Open it whenever you're sitting outside, need a quiet minute, or just want to clear your head.",
        body_style
    ))

    story.append(Paragraph(
        "Here’s to a calm, grounded, beautiful, and gentle 28th year.",
        body_bold
    ))

    story.append(Spacer(1, 16))

    # QR Code Section Box
    qr_table_data = [
        [
            RLImage(qr_path, width=105, height=105),
            Paragraph(
                "<b>Shalini's Sanctuary</b><br/>"
                "<font color='#64748B' size='8.5'>Scan with your phone camera whenever you are outside with a quiet minute.</font><br/><br/>"
                "<font color='#D97706' size='8'>✨ Featuring the 28-Piece Mind Unfurl • The Ambient Glow • Secret Compass • Brain Dump • Zen Pond</font>",
                body_style
            )
        ]
    ]

    t_qr = Table(qr_table_data, colWidths=[120, 340])
    t_qr.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#CBD5E1")),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ]))
    story.append(t_qr)

    doc.build(story)
    print(f"✅ Successfully generated Shalini's printable letter at: {filename}")

if __name__ == "__main__":
    build_letter_pdf()
