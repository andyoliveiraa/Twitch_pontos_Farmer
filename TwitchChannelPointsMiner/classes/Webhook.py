from textwrap import dedent

import requests

from TwitchChannelPointsMiner.classes.Settings import Events


class Webhook(object):
    __slots__ = ["endpoint", "method", "events"]

    def __init__(self, endpoint: str, method: str, events: list):
        self.endpoint = endpoint
        self.method = method
        self.events = [str(e) for e in events]

    def send(self, message: str, event: Events) -> None:
        if str(event) in self.events:
            if not self.endpoint or not self.endpoint.startswith(("http://", "https://")):
                return

            url = self.endpoint + f"?event_name={str(event)}&message={message}"
            try:
                if self.method.lower() == "get":
                    requests.get(url=url, timeout=10)
                elif self.method.lower() == "post":
                    requests.post(url=url, timeout=10)
            except Exception:
                pass
