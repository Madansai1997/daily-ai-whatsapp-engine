import sys
import os
import base64
import io
import asyncio
from datetime import datetime, timezone
import aiosqlite
import httpx
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from dotenv import load_dotenv

load_dotenv()

# Database path compatibility
DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

async def get_db():
    return aiosqlite.connect(DB_PATH)

def build_docx():
    doc = Document()
    
    # Page Setup - Margins: 0.75 in on all sides
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(0.75)
        section.bottom_margin = Inches(0.75)
        section.left_margin = Inches(0.75)
        section.right_margin = Inches(0.75)
        
    # Styles Setup
    style_normal = doc.styles['Normal']
    font = style_normal.font
    font.name = 'Calibri'
    font.size = Pt(11)
    font.color.rgb = RGBColor(0x33, 0x33, 0x33) # Off-black
    
    # Helper to add bold/italic centered header text
    def add_header_line(text, size, bold=False, italic=False, space_after=0):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(space_after)
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.line_spacing = 1.05
        run = p.add_run(text)
        run.font.size = Pt(size)
        run.bold = bold
        run.italic = italic
        return p

    # Header Name (clean ASCII, no special chars)
    add_header_line("MADAN SAI DARAM", 18, bold=True, space_after=2)
    
    # Contact Details (using commas instead of pipes/dashes to satisfy ATS)
    add_header_line(
        "Hyderabad, India  ,  +91 9963214141  ,  madansai303@gmail.com  ,  linkedin.com/in/madan-sai-daram-a26735313", 
        10, 
        space_after=4
    )
    
    # Headline (ATS-compliant headline format, no pipes)
    add_header_line("Data Analyst - Business Intelligence, SQL, Power BI, Snowflake", 11, bold=True, italic=True, space_after=12)
    
    # Helper to add section headers
    def add_section_header(title):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(12)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.keep_with_next = True
        run = p.add_run(title.upper())
        run.bold = True
        run.font.size = Pt(12)
        run.font.color.rgb = RGBColor(0x1B, 0x36, 0x5D) # Navy color for structure
        
        # Add bottom border/separator
        p_border = doc.add_paragraph()
        p_border.paragraph_format.space_before = Pt(0)
        p_border.paragraph_format.space_after = Pt(6)
        run_border = p_border.add_run("―" * 58)
        run_border.font.size = Pt(8)
        run_border.font.color.rgb = RGBColor(0xBB, 0xBB, 0xBB)

    # Helper to add standard bullets (ending with periods)
    def add_bullet(text):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(3)
        p.paragraph_format.line_spacing = 1.15
        run = p.add_run(text)
        run.font.size = Pt(10.5)

    # 1. Summary
    add_section_header("Summary")
    p_sum = doc.add_paragraph()
    p_sum.paragraph_format.space_before = Pt(0)
    p_sum.paragraph_format.space_after = Pt(8)
    p_sum.paragraph_format.line_spacing = 1.15
    run_sum = p_sum.add_run(
        "Results-driven Data Analyst with 4+ years of experience delivering SQL analytics, reporting automation, "
        "data validation, and dashboard solutions across cloud data platforms. Improved reporting efficiency by ~40%, "
        "reduced manual effort by 25%, and supported more than 10 business KPIs through scalable reporting and automation. "
        "Expert in advanced SQL (CTEs, window functions), Power BI, Snowflake, and BigQuery to improve data accuracy, "
        "strengthen reporting reliability, and support business decision-making."
    )
    run_sum.font.size = Pt(10.5)
    
    # 2. Experience
    add_section_header("Professional Experience")
    
    # Job 1
    p_job1 = doc.add_paragraph()
    p_job1.paragraph_format.space_before = Pt(4)
    p_job1.paragraph_format.space_after = Pt(2)
    p_job1.paragraph_format.keep_with_next = True
    r_j1_title = p_job1.add_run("MyTech Detectives")
    r_j1_title.bold = True
    r_j1_title.font.size = Pt(11)
    r_j1_text = p_job1.add_run(" — Data Analyst | Hyderabad, India")
    r_j1_text.font.size = Pt(11)
    
    p_job1_date = doc.add_paragraph()
    p_job1_date.paragraph_format.space_before = Pt(0)
    p_job1_date.paragraph_format.space_after = Pt(4)
    r_j1_date = p_job1_date.add_run("Jul 2024 – Present")
    r_j1_date.italic = True
    r_j1_date.font.size = Pt(10)
    r_j1_date.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    
    add_bullet("Developed 5+ interactive Power BI dashboards tracking 10+ key business KPIs, increasing operational efficiency visibility by 25% and supporting business reporting.")
    add_bullet("Optimized SQL queries across Snowflake and BigQuery, reducing report generation time by 30% through efficient data extraction and transformation workflows.")
    add_bullet("Engineered Python-based (Pandas, NumPy) automated data cleaning and EDA scripts, detecting 15+ critical data anomalies and improving overall reporting accuracy by 20%.")
    add_bullet("Led data validation and reconciliation efforts between source systems and warehouse tables, improving report reliability by 20%.")
    add_bullet("Architected reusable SQL-based curated reporting datasets, decreasing ad-hoc data requests by 40% and standardizing reporting consistency across business teams.")
    add_bullet("Partnered with data engineering teams to resolve transactional data discrepancies, improving critical reporting dataset availability to 99.5% and reducing resolution times by 15%.")
    
    # Job 2
    p_job2 = doc.add_paragraph()
    p_job2.paragraph_format.space_before = Pt(8)
    p_job2.paragraph_format.space_after = Pt(2)
    p_job2.paragraph_format.keep_with_next = True
    r_j2_title = p_job2.add_run("Cognizant Technology Solutions")
    r_j2_title.bold = True
    r_j2_title.font.size = Pt(11)
    r_j2_text = p_job2.add_run(" — Associate Test Engineer | Hyderabad, India")
    r_j2_text.font.size = Pt(11)
    
    p_job2_date = doc.add_paragraph()
    p_job2_date.paragraph_format.space_before = Pt(0)
    p_job2_date.paragraph_format.space_after = Pt(4)
    r_j2_date = p_job2_date.add_run("Sep 2019 – Jul 2022")
    r_j2_date.italic = True
    r_j2_date.font.size = Pt(10)
    r_j2_date.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    
    add_bullet("Ensured 99.8% data integrity across 4+ large-scale HIPAA-compliant healthcare applications by leading end-to-end functional and validation testing.")
    add_bullet("Developed and maintained Selenium automation frameworks, reducing manual regression effort by 25%.")
    add_bullet("Optimized test execution using BrowserStack, reducing regression cycles by 35% through parallel cross-browser testing.")
    add_bullet("Validated backend transactional data accuracy across systems using 100+ complex SQL verification queries, achieving a 98% data-quality score.")
    add_bullet("Streamlined cross-functional data flows with engineering and business teams, reducing data latency by 25% and improving access to critical insights.")
    add_bullet("Mentored junior team members, increasing Selenium automation framework stability and reducing critical post-release defects by 30% within six months.")

    # 3. Projects
    add_section_header("Projects")
    
    p_p1 = doc.add_paragraph()
    p_p1.paragraph_format.space_before = Pt(4)
    p_p1.paragraph_format.space_after = Pt(4)
    r_p1 = p_p1.add_run("Customer Churn Analysis (Python + SQL)")
    r_p1.bold = True
    r_p1.font.size = Pt(11)
    
    add_bullet("Analyzed 7K+ subscription customer records using SQL and Python to identify churn trends across contract type, tenure, and customer engagement behavior.")
    add_bullet("Applied cohort analysis, feature correlation, and window functions to identify high-risk segments contributing to an 8% monthly churn rate reduction.")
    add_bullet("Built interactive Power BI dashboards tracking churn rate, retention trends, and revenue-at-risk KPIs, mapping $250K+ in potential revenue recovery.")
    add_bullet("Utilized joins, CTEs, and data validation pipelines, improving overall database query execution and data validation speed by 35%.")
    
    p_p2 = doc.add_paragraph()
    p_p2.paragraph_format.space_before = Pt(6)
    p_p2.paragraph_format.space_after = Pt(4)
    r_p2 = p_p2.add_run("Sales Performance & Revenue Analytics Dashboard (Power BI + SQL)")
    r_p2.bold = True
    r_p2.font.size = Pt(11)
    
    add_bullet("Developed interactive Power BI dashboards analyzing regional sales performance, product-level revenue trends, and monthly KPIs, identifying $45K+ in monthly opportunities.")
    add_bullet("Automated data extraction, transformation, and monthly KPI reporting using SQL and Power Query, saving 4+ hours of manual effort weekly.")
    add_bullet("Analyzed seasonal demand patterns, sales growth trends, and regional revenue performance to identify high-performing segments and operational opportunities.")
    add_bullet("Created executive-level visualizations supporting stakeholder reporting and business decision-making across sales and revenue operations.")

    # 4. Certifications
    add_section_header("Certifications")
    add_bullet("Microsoft Certified: Power BI Data Analyst Associate (PL-300)")
    add_bullet("Google Data Analytics Professional Certificate")

    # 5. Education
    add_section_header("Education")
    p_ed1 = doc.add_paragraph()
    p_ed1.paragraph_format.space_before = Pt(2)
    p_ed1.paragraph_format.space_after = Pt(2)
    r_ed1_univ = p_ed1.add_run("Florida International University")
    r_ed1_univ.bold = True
    r_ed1_univ.font.size = Pt(11)
    r_ed1_deg = p_ed1.add_run(", Miami, US — MS in Data Science and AI ")
    r_ed1_deg.font.size = Pt(11)
    r_ed1_date = p_ed1.add_run("(Aug 2022 – May 2024)")
    r_ed1_date.italic = True
    r_ed1_date.font.size = Pt(10)
    r_ed1_date.font.color.rgb = RGBColor(0x66, 0x66, 0x66)
    
    p_ed2 = doc.add_paragraph()
    p_ed2.paragraph_format.space_before = Pt(4)
    p_ed2.paragraph_format.space_after = Pt(4)
    r_ed2_univ = p_ed2.add_run("Jawaharlal Nehru Technological University")
    r_ed2_univ.bold = True
    r_ed2_univ.font.size = Pt(11)
    r_ed2_deg = p_ed2.add_run(", Hyderabad, India — Bachelors in Electronics and Communication Engineering ")
    r_ed2_deg.font.size = Pt(11)
    r_ed2_date = p_ed2.add_run("(Sep 2014 – May 2018)")
    r_ed2_date.italic = True
    r_ed2_date.font.size = Pt(10)
    r_ed2_date.font.color.rgb = RGBColor(0x66, 0x66, 0x66)

    # 6. Skills
    add_section_header("Skills")
    
    def add_skill_line(category, list_text):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(4)
        p.paragraph_format.line_spacing = 1.15
        r_cat = p.add_run(category + ": ")
        r_cat.bold = True
        r_cat.font.size = Pt(10.5)
        r_val = p.add_run(list_text)
        r_val.font.size = Pt(10.5)

    add_skill_line("Programming", "SQL (Advanced: Joins, CTEs, Window Functions), Python (Pandas, NumPy, Scikit-learn), R")
    add_skill_line("Visualization", "Power BI (DAX, Power Query), Tableau, Excel (Pivot Tables, VLOOKUP)")
    add_skill_line("Databases & Cloud", "Snowflake, BigQuery, SQL Server, Azure, AWS, GCP, MySQL")
    add_skill_line("Data Engineering", "ETL/ELT Pipelines, Data Warehousing, Data Modeling, dbt, Looker, Data Validation")
    add_skill_line("Methodologies", "Exploratory Data Analysis (EDA), Statistical Analysis, Statistical Modeling, Machine Learning (Classification, Clustering, Regression), A/B Testing, Hypothesis Testing")

    # 7. Achievements & Awards
    add_section_header("Achievements & Awards")
    add_bullet("Solved 50+ advanced SQL problems covering joins, CTEs, and window functions.")
    add_bullet("Transitioned from QA to Data Analytics through self-driven learning and practical projects.")

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()

async def update_databases(docx_bytes, plain_text):
    filename = "Madan_Sai_Daram_DA_CV.docx"
    now = datetime.now(timezone.utc).isoformat()
    docx_b64 = base64.b64encode(docx_bytes).decode("utf-8")
    
    # 1. Update local SQLite
    async with aiosqlite.connect("agent_memory.db") as db:
        await db.execute(
            """INSERT INTO resume_docx (id, filename, data_b64, updated_at) VALUES (1, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, data_b64=excluded.data_b64,
                 updated_at=excluded.updated_at""",
            (filename, docx_b64, now)
        )
        await db.execute(
            """INSERT INTO user_resume_templates (domain, content, updated_at) VALUES ('data_analyst', ?, ?)
               ON CONFLICT(domain) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at""",
            (plain_text, now)
        )
        await db.commit()
    print("✅ Local SQLite database successfully updated.")

    # 2. Update production Turso if set
    turso_url = os.environ.get("TURSO_DATABASE_URL")
    turso_token = os.environ.get("TURSO_AUTH_TOKEN")
    if turso_url and turso_token:
        url = turso_url.replace("libsql://", "https://").rstrip("/")
        headers = {"authorization": f"Bearer {turso_token}"}
        
        # Save docx
        body_docx = {
            "stmt": {
                "sql": """INSERT INTO resume_docx (id, filename, data_b64, updated_at) VALUES (1, ?, ?, ?)
                          ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, data_b64=excluded.data_b64,
                            updated_at=excluded.updated_at""",
                "args": [
                    {"type": "text", "value": filename},
                    {"type": "text", "value": docx_b64},
                    {"type": "text", "value": now}
                ],
                "named_args": [],
                "want_rows": False
            }
        }
        resp_docx = httpx.post(f"{url}/v1/execute", json=body_docx, headers=headers).json()
        
        # Save template text
        body_text = {
            "stmt": {
                "sql": """INSERT INTO user_resume_templates (domain, content, updated_at) VALUES ('data_analyst', ?, ?)
                          ON CONFLICT(domain) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at""",
                "args": [
                    {"type": "text", "value": plain_text},
                    {"type": "text", "value": now}
                ],
                "named_args": [],
                "want_rows": False
            }
        }
        resp_text = httpx.post(f"{url}/v1/execute", json=body_text, headers=headers).json()
        print("✅ Production Turso database successfully updated.")
    else:
        print("⚠️ Turso env variables missing, production database NOT updated.")

async def main():
    print("🔄 Generating clean, optimized Word Document...")
    docx_bytes = build_docx()
    
    # Update local text file first
    plain_text_res = """MADAN SAI DARAM
Hyderabad, India , +91 9963214141 , madansai303@gmail.com , linkedin.com/in/madan-sai-daram-a26735313
Data Analyst - Business Intelligence, SQL, Power BI, Snowflake

SUMMARY
Results-driven Data Analyst with 4+ years of experience delivering SQL analytics, reporting automation, data validation, and dashboard solutions across cloud data platforms. Improved reporting efficiency by ~40%, reduced manual effort by 25%, and supported more than 10 business KPIs through scalable reporting and automation. Expert in advanced SQL (CTEs, window functions), Power BI, Snowflake, and BigQuery to improve data accuracy, strengthen reporting reliability, and support business decision-making.

PROFESSIONAL EXPERIENCE

MyTech Detectives — Data Analyst | Hyderabad, India
Jul 2024 – Present
- Developed 5+ interactive Power BI dashboards tracking 10+ key business KPIs, increasing operational efficiency visibility by 25% and supporting business reporting.
- Optimized SQL queries across Snowflake and BigQuery, reducing report generation time by 30% through efficient data extraction and transformation workflows.
- Engineered Python-based (Pandas, NumPy) automated data cleaning and EDA scripts, detecting 15+ critical data anomalies and improving overall reporting accuracy by 20%.
- Led data validation and reconciliation efforts between source systems and warehouse tables, improving report reliability by 20%.
- Architected reusable SQL-based curated reporting datasets, decreasing ad-hoc data requests by 40% and standardizing reporting consistency across business teams.
- Partnered with data engineering teams to resolve transactional data discrepancies, improving critical reporting dataset availability to 99.5% and reducing resolution times by 15%.

Cognizant Technology Solutions — Associate Test Engineer | Hyderabad, India
Sep 2019 – Jul 2022
- Ensured 99.8% data integrity across 4+ large-scale HIPAA-compliant healthcare applications by leading end-to-end functional and validation testing.
- Developed and maintained Selenium automation frameworks, reducing manual regression effort by 25%.
- Optimized test execution using BrowserStack, reducing regression cycles by 35% through parallel cross-browser testing.
- Validated backend transactional data accuracy across systems using 100+ complex SQL verification queries, achieving a 98% data-quality score.
- Streamlined cross-functional data flows with engineering and business teams, reducing data latency by 25% and improving access to critical insights.
- Mentored junior team members, increasing Selenium automation framework stability and reducing critical post-release defects by 30% within six months.

PROJECTS

Customer Churn Analysis (Python + SQL)
- Analyzed 7K+ subscription customer records using SQL and Python to identify churn trends across contract type, tenure, and customer engagement behavior.
- Applied cohort analysis, feature correlation, and window functions to identify high-risk segments contributing to an 8% monthly churn rate reduction.
- Built interactive Power BI dashboards tracking churn rate, retention trends, and revenue-at-risk KPIs, mapping $250K+ in potential revenue recovery.
- Utilized joins, CTEs, and data validation pipelines, improving overall database query execution and data validation speed by 35%.

Sales Performance & Revenue Analytics Dashboard (Power BI + SQL)
- Developed interactive Power BI dashboards analyzing regional sales performance, product-level revenue trends, and monthly KPIs, identifying $45K+ in monthly opportunities.
- Automated data extraction, transformation, and monthly KPI reporting using SQL and Power Query, saving 4+ hours of manual effort weekly.
- Analyzed seasonal demand patterns, sales growth trends, and regional revenue performance to identify high-performing segments and operational opportunities.
- Created executive-level visualizations supporting stakeholder reporting and business decision-making across sales and revenue operations.

CERTIFICATIONS
- Microsoft Certified: Power BI Data Analyst Associate (PL-300)
- Google Data Analytics Professional Certificate

EDUCATION
Florida International University, Miami, US — MS in Data Science and AI (Aug 2022 – May 2024)
Jawaharlal Nehru Technological University, Hyderabad, India — Bachelors in Electronics and Communication Engineering (Sep 2014 – May 2018)

SKILLS
Programming: SQL (Advanced: Joins, CTEs, Window Functions), Python (Pandas, NumPy, Scikit-learn), R
Visualization: Power BI (DAX, Power Query), Tableau, Excel (Pivot Tables, VLOOKUP)
Databases & Cloud: Snowflake, BigQuery, SQL Server, Azure, AWS, GCP, MySQL
Data Engineering: ETL/ELT Pipelines, Data Warehousing, Data Modeling, dbt, Looker, Data Validation
Methodologies: Exploratory Data Analysis (EDA), Statistical Analysis, Statistical Modeling, Machine Learning (Classification, Clustering, Regression), A/B Testing, Hypothesis Testing

ACHIEVEMENTS & AWARDS
- Solved 50+ advanced SQL problems covering joins, CTEs, and window functions.
- Transitioned from QA to Data Analytics through self-driven learning and practical projects."""
    
    with open("master_da_resume.txt", "w") as f:
        f.write(plain_text_res.strip())
        
    print("🔄 Writing text content to databases...")
    await update_databases(docx_bytes, plain_text_res.strip())
    
    # 3. Trigger a fresh audit to update the score on the new resume
    print("🔄 Running fresh resume audit on updated template...")
    from V3_updates import audit_resume, call_llm
    audit = await audit_resume(call_llm)
    print("✨ Re-audit completed successfully! New Audit Data:")
    print("Score:", audit.get("overall_score"))
    print("Verdict:", audit.get("verdict"))

if __name__ == "__main__":
    asyncio.run(main())
