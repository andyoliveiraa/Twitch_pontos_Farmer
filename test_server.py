# -*- coding: utf-8 -*-
import os
import json
from pathlib import Path
from TwitchChannelPointsMiner.classes.AnalyticsServer import AnalyticsServer

class MockTwitch:
    def get_followers(self):
        # Mock followed streamers list for testing
        return ["shroud", "xqc", "ninja", "gaules", "loud_coringa", "alanzoka"]

class MockMiner:
    def __init__(self):
        self.username = "andy47dias"
        self.running = True
        self.session_id = "mock-session-123"
        self.start_datetime = None
        self.streamers = []
        self.ws_pool = None
        self.twitch = MockTwitch()

if __name__ == "__main__":
    miner = MockMiner()
    server = AnalyticsServer(
        host="127.0.0.1",
        port=8080,
        refresh=5,
        days_ago=7,
        username="andy47dias",
        miner_instance=miner
    )
    server.run()
