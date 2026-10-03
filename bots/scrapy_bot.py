"""
T1 scraper with Scrapy: crawls the site with Scrapy's defaults (its own user
agent, no JavaScript), then tries the login API, like a credential-stuffing
spider would.

    python bots/scrapy_bot.py --target http://localhost:8000 --runs 3
"""
import json

import scrapy
from scrapy.crawler import CrawlerProcess

from common import args, credentials, emit

a = args()
TARGET = a.target.rstrip("/")


class Spider(scrapy.Spider):
    name = "aegis-pentest"
    custom_settings = {"ROBOTSTXT_OBEY": False, "HTTPERROR_ALLOW_ALL": True,
                       "COOKIES_ENABLED": True, "RETRY_ENABLED": False,
                       "CONCURRENT_REQUESTS": 1}

    def __init__(self, run: int = 0, **kw):
        super().__init__(**kw)
        self.run = run
        self.pages = []

    async def start(self):
        # Scrapy >= 2.13 entry point
        for request in self.start_requests():
            yield request

    def start_requests(self):
        for path in ("/", "/sdk/aegis.min.js", "/products", "/about", "/search?q=test"):
            yield scrapy.Request(TARGET + path, callback=self.page, dont_filter=True, cb_kwargs={"path": path},
                                 priority=10)
        # Lower priority: sent after the crawl
        user, password = credentials(TARGET)
        yield scrapy.Request(TARGET + "/api/login", method="POST", callback=self.login, dont_filter=True,
                             body=json.dumps({"username": user, "password": password}),
                             headers={"Content-Type": "application/json"}, priority=0)

    def page(self, response, path):
        self.pages.append({"path": path, "status": response.status})

    def login(self, response):
        try:
            body = json.loads(response.text)
        except ValueError:
            body = response.text[:200]
        emit("scrapy", TARGET, self.run, login_status=response.status, login_body=body, pages=self.pages)


process = CrawlerProcess(settings={"LOG_ENABLED": False})
for i in range(a.runs):
    process.crawl(Spider, run=i)
process.start()
