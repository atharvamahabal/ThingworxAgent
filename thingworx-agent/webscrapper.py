import requests
from bs4 import BeautifulSoup
import os

# Your page URL
url = "https://support.ptc.com/help/thingworx/platform/r9.6/en/index.html#page/ThingWorx/Welcome.html"
# Fetch HTML
res = requests.get(url)
soup = BeautifulSoup(res.text, "html.parser")

# Create folder for PDFs
os.makedirs("ptc_pdfs", exist_ok=True)

# Find all .pdf links
links = [a["href"] for a in soup.find_all("a", href=True) if a["href"].lower().endswith(".pdf")]

for link in links:
    # Convert relative links to absolute if needed
    pdf_url = requests.compat.urljoin(url, link)
    print("Downloading:", pdf_url)

    r = requests.get(pdf_url)
    filename = os.path.join("ptc_pdfs", pdf_url.split("/")[-1])
    with open(filename, "wb") as f:
        f.write(r.content)