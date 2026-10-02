"""
Compiles card.html into a high-quality printable PDF using headless Chrome with base64 embedded QR code.
"""
import os
import base64
import subprocess

def create_card_pdf():
    cwd = "/Users/madansaidaram/Desktop/Daily_AI_updates"
    html_path = os.path.join(cwd, "card.html")
    qr_path = os.path.join(cwd, "haven_qr_code.png")
    pdf_path = os.path.join(cwd, "card.pdf")
    temp_html = os.path.join(cwd, "card_print_ready.html")

    # Read base64 of QR code
    with open(qr_path, "rb") as f:
        qr_b64 = base64.b64encode(f.read()).decode("utf-8")
    
    qr_data_uri = f"data:image/png;base64,{qr_b64}"

    with open(html_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Replace local img src with embedded data URI
    content = content.replace('src="haven_qr_code.png"', f'src="{qr_data_uri}"')

    # Add print-color-adjust
    content = content.replace('body {', 'body {\n            -webkit-print-color-adjust: exact;\n            print-color-adjust: exact;')

    with open(temp_html, "w", encoding="utf-8") as f:
        f.write(content)

    # Compile with headless Chrome
    chrome_bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    cmd = [
        chrome_bin,
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={pdf_path}",
        temp_html
    ]

    print(f"Running: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"✅ Successfully compiled {pdf_path}")
        # Clean temp
        if os.path.exists(temp_html):
            os.remove(temp_html)
    else:
        print(f"❌ Error: {res.stderr}")

if __name__ == "__main__":
    create_card_pdf()
