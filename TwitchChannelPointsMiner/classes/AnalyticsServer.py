import json
import logging
import os
from datetime import datetime
from pathlib import Path
from threading import Thread

import pandas as pd
from flask import Flask, Response, cli, render_template, request

from TwitchChannelPointsMiner.classes.Settings import Settings
from TwitchChannelPointsMiner.utils import download_file

cli.show_server_banner = lambda *_: None
logger = logging.getLogger(__name__)


def streamers_available():
    path = Settings.analytics_path
    return [
        f
        for f in os.listdir(path)
        if os.path.isfile(os.path.join(path, f)) and f.endswith(".json")
    ]


def aggregate(df, freq="30Min"):
    df_base_events = df[(df.z == "Watch") | (df.z == "Claim")]
    df_other_events = df[(df.z != "Watch") & (df.z != "Claim")]

    be = df_base_events.groupby(
        [pd.Grouper(freq=freq, key="datetime"), "z"]).max()
    be = be.reset_index()

    oe = df_other_events.groupby(
        [pd.Grouper(freq=freq, key="datetime"), "z"]).max()
    oe = oe.reset_index()

    result = pd.concat([be, oe])
    return result


def filter_datas(start_date, end_date, datas):
    # Note: https://stackoverflow.com/questions/4676195/why-do-i-need-to-multiply-unix-timestamps-by-1000-in-javascript
    start_date = (
        datetime.strptime(start_date, "%Y-%m-%d").timestamp() * 1000
        if start_date is not None
        else 0
    )
    end_date = (
        datetime.strptime(end_date, "%Y-%m-%d")
        if end_date is not None
        else datetime.now()
    ).replace(hour=23, minute=59, second=59).timestamp() * 1000

    original_series = datas["series"]

    if "series" in datas:
        df = pd.DataFrame(datas["series"])
        df["datetime"] = pd.to_datetime(df.x // 1000, unit="s")

        df = df[(df.x >= start_date) & (df.x <= end_date)]

        datas["series"] = (
            df.drop(columns="datetime")
            .sort_values(by=["x", "y"], ascending=True)
            .to_dict("records")
        )
    else:
        datas["series"] = []

    # If no data is found within the timeframe, that usually means the streamer hasn't streamed within that timeframe
    # We create a series that shows up as a straight line on the dashboard, with 'No Stream' as labels
    if len(datas["series"]) == 0:
        new_end_date = start_date
        new_start_date = 0
        df = pd.DataFrame(original_series)
        df["datetime"] = pd.to_datetime(df.x // 1000, unit="s")

        # Attempt to get the last known balance from before the provided timeframe
        df = df[(df.x >= new_start_date) & (df.x <= new_end_date)]
        last_balance = df.drop(columns="datetime").sort_values(
            by=["x", "y"], ascending=True).to_dict("records")[-1]['y']

        datas["series"] = [{'x': start_date, 'y': last_balance, 'z': 'No Stream'}, {
            'x': end_date, 'y': last_balance, 'z': 'No Stream'}]

    if "annotations" in datas:
        df = pd.DataFrame(datas["annotations"])
        df["datetime"] = pd.to_datetime(df.x // 1000, unit="s")

        df = df[(df.x >= start_date) & (df.x <= end_date)]

        datas["annotations"] = (
            df.drop(columns="datetime")
            .sort_values(by="x", ascending=True)
            .to_dict("records")
        )
    else:
        datas["annotations"] = []

    return datas


def read_json(streamer, return_response=True):
    start_date = request.args.get("startDate", type=str)
    end_date = request.args.get("endDate", type=str)

    path = Settings.analytics_path
    streamer = streamer if streamer.endswith(".json") else f"{streamer}.json"

    # Check if the file exists before attempting to read it
    if not os.path.exists(os.path.join(path, streamer)):
        error_message = f"File '{streamer}' not found."
        logger.error(error_message)
        if return_response:
            return Response(json.dumps({"error": error_message}), status=404, mimetype="application/json")
        else:
            return {"error": error_message}

    try:
        with open(os.path.join(path, streamer), 'r') as file:
            data = json.load(file)
    except json.JSONDecodeError as e:
        error_message = f"Error decoding JSON in file '{streamer}': {str(e)}"
        logger.error(error_message)
        if return_response:
            return Response(json.dumps({"error": error_message}), status=500, mimetype="application/json")
        else:
            return {"error": error_message}

    # Handle filtering data, if applicable
    filtered_data = filter_datas(start_date, end_date, data)
    if return_response:
        return Response(json.dumps(filtered_data), status=200, mimetype="application/json")
    else:
        return filtered_data


def get_challenge_points(streamer):
    datas = read_json(streamer, return_response=False)
    if "series" in datas and datas["series"]:
        return datas["series"][-1]["y"]
    return 0  # Default value when 'series' key is not found or empty


def get_last_activity(streamer):
    datas = read_json(streamer, return_response=False)
    if "series" in datas and datas["series"]:
        return datas["series"][-1]["x"]
    return 0  # Default value when 'series' key is not found or empty


def json_all():
    return Response(
        json.dumps(
            [
                {
                    "name": streamer.strip(".json"),
                    "data": read_json(streamer, return_response=False),
                }
                for streamer in streamers_available()
            ]
        ),
        status=200,
        mimetype="application/json",
    )


def index(refresh=5, days_ago=7):
    return render_template(
        "charts.html",
        refresh=(refresh * 60 * 1000),
        daysAgo=days_ago,
    )


def streamers():
    return Response(
        json.dumps(
            [
                {"name": s, "points": get_challenge_points(
                    s), "last_activity": get_last_activity(s)}
                for s in sorted(streamers_available())
            ]
        ),
        status=200,
        mimetype="application/json",
    )


def download_assets(assets_folder, required_files):
    Path(assets_folder).mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading assets to {assets_folder}")

    for f in required_files:
        if os.path.isfile(os.path.join(assets_folder, f)) is False:
            if (
                download_file(os.path.join("assets", f),
                              os.path.join(assets_folder, f))
                is True
            ):
                logger.info(f"Downloaded {f}")


def check_assets():
    required_files = [
        "banner.png",
        "charts.html",
        "script.js",
        "style.css",
        "dark-theme.css",
    ]
    assets_folder = os.path.join(Path().absolute(), "assets")
    if os.path.isdir(assets_folder) is False:
        logger.info(f"Assets folder not found at {assets_folder}")
        download_assets(assets_folder, required_files)
    else:
        for f in required_files:
            if os.path.isfile(os.path.join(assets_folder, f)) is False:
                logger.info(f"Missing file {f} in {assets_folder}")
                download_assets(assets_folder, required_files)
                break

def sync_streamers_in_memory(miner, new_streamers_list):
    from TwitchChannelPointsMiner.classes.entities.Streamer import Streamer, StreamerSettings
    from TwitchChannelPointsMiner.classes.Chat import ChatPresence, ThreadChat
    from TwitchChannelPointsMiner.classes.entities.PubsubTopic import PubsubTopic
    from TwitchChannelPointsMiner.utils import set_default_settings
    from TwitchChannelPointsMiner.classes.Settings import Settings
    
    # 1. Obter lista de usernames do novo JSON
    new_usernames = {item.get("username", "").lower().strip() for item in new_streamers_list if item.get("username")}
    
    # 2. Remover streamers que não estão no novo JSON
    to_remove = []
    for s in miner.streamers:
        if s.username.lower() not in new_usernames:
            to_remove.append(s)
            
    for s in to_remove:
        logger.info(f"Removing streamer dynamically: {s.username}")
        try:
            if s.irc_chat and s.settings.chat != ChatPresence.NEVER:
                s.leave_chat()
        except Exception as e:
            logger.warning(f"Error leaving IRC chat for {s.username}: {e}")
        try:
            miner.streamers.remove(s)
        except Exception as e:
            pass
        
    # 3. Adicionar ou atualizar streamers
    running_streamers = {s.username.lower(): s for s in miner.streamers}
    
    for item in new_streamers_list:
        username = item.get("username", "").lower().strip()
        if not username:
            continue
            
        streamer_settings = StreamerSettings(
            make_predictions=item.get("make_predictions", False),
            follow_raid=item.get("follow_raid", True),
            claim_drops=item.get("claim_drops", True),
            watch_streak=item.get("watch_streak", True)
        )
        
        if username in running_streamers:
            # Atualiza configurações
            s = running_streamers[username]
            s.settings.make_predictions = streamer_settings.make_predictions
            s.settings.follow_raid = streamer_settings.follow_raid
            s.settings.claim_drops = streamer_settings.claim_drops
            s.settings.watch_streak = streamer_settings.watch_streak
            logger.info(f"Updated settings for streamer: {s.username}")
        else:
            # Adiciona novo streamer
            logger.info(f"Adding new streamer dynamically: {username}")
            try:
                streamer = Streamer(username, streamer_settings)
                streamer.channel_id = miner.twitch.get_channel_id(username)
                
                streamer.settings = set_default_settings(
                    streamer.settings, Settings.streamer_settings
                )
                streamer.settings.bet = set_default_settings(
                    streamer.settings.bet, Settings.streamer_settings.bet
                )
                
                if streamer.settings.chat != ChatPresence.NEVER:
                    streamer.irc_chat = ThreadChat(
                        miner.username,
                        miner.twitch.twitch_login.get_auth_token(),
                        streamer.username,
                    )
                    
                miner.streamers.append(streamer)
                
                # Carregar o contexto inicial
                miner.twitch.load_channel_points_context(streamer)
                miner.twitch.check_streamer_online(streamer)
                
                # Submeter ao Websocket Pool
                if miner.ws_pool:
                    miner.ws_pool.submit(PubsubTopic("video-playback-by-id", streamer=streamer))
                    if streamer.settings.follow_raid:
                        miner.ws_pool.submit(PubsubTopic("raid", streamer=streamer))
                    if streamer.settings.make_predictions:
                        miner.ws_pool.submit(PubsubTopic("predictions-channel-v1", streamer=streamer))
                    if streamer.settings.claim_moments:
                        miner.ws_pool.submit(PubsubTopic("community-moments-channel-v1", streamer=streamer))
                    if streamer.settings.community_goals:
                        miner.ws_pool.submit(PubsubTopic("community-points-channel-v1", streamer=streamer))
                        
            except Exception as e:
                logger.error(f"Failed to add streamer {username} dynamically: {e}")

last_sent_log_index = 0

class AnalyticsServer(Thread):
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 5000,
        refresh: int = 5,
        days_ago: int = 7,
        username: str = None,
        miner_instance = None
    ):
        super(AnalyticsServer, self).__init__()

        check_assets()

        self.host = host
        self.port = port
        self.refresh = refresh
        self.days_ago = days_ago
        self.username = username
        self.miner = miner_instance

        def generate_log():
            global last_sent_log_index  # Use the global variable

            # Get the last received log index from the client request parameters
            last_received_index = int(request.args.get("lastIndex", last_sent_log_index))

            logs_path = os.path.join(Path().absolute(), "logs")
            log_file_path = os.path.join(logs_path, f"{username}.log")
            try:
                with open(log_file_path, "r", encoding="utf-8") as log_file:
                    log_content = log_file.read()

                # Extract new log entries since the last received index
                new_log_entries = log_content[last_received_index:]
                last_sent_log_index = len(log_content)  # Update the last sent index

                return Response(new_log_entries, status=200, mimetype="text/plain")

            except FileNotFoundError:
                return Response("Log file not found.", status=404, mimetype="text/plain")

        def get_streamers_config():
            streamers_json_path = os.path.join(Path().absolute(), "streamers.json")
            if os.path.exists(streamers_json_path):
                try:
                    with open(streamers_json_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    
                    if self.miner:
                        running_streamers = {s.username.lower(): s for s in self.miner.streamers}
                        for item in data:
                            uname = item.get("username", "").lower().strip()
                            if uname in running_streamers:
                                item["is_online"] = running_streamers[uname].is_online
                                item["points"] = running_streamers[uname].channel_points
                                item["running"] = True
                            else:
                                item["is_online"] = False
                                item["points"] = 0
                                item["running"] = False
                    return Response(json.dumps(data), status=200, mimetype="application/json")
                except Exception as e:
                    return Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json")
            return Response(json.dumps([]), status=200, mimetype="application/json")

        def save_streamers_config():
            try:
                new_data = request.json
                if not isinstance(new_data, list):
                    return Response(json.dumps({"error": "Data must be a list"}), status=400, mimetype="application/json")
                
                streamers_json_path = os.path.join(Path().absolute(), "streamers.json")
                with open(streamers_json_path, "w", encoding="utf-8") as f:
                    json.dump(new_data, f, indent=2, ensure_ascii=False)
                
                if self.miner:
                    sync_streamers_in_memory(self.miner, new_data)
                
                return Response(json.dumps({"status": "success", "message": "Streamers saved and synchronized"}), status=200, mimetype="application/json")
            except Exception as e:
                return Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json")

        def get_miner_status():
            if not self.miner:
                return Response(json.dumps({"running": False}), status=200, mimetype="application/json")
            
            uptime_str = "00:00:00"
            if self.miner.start_datetime:
                delta = datetime.now() - self.miner.start_datetime
                hours, remainder = divmod(int(delta.total_seconds()), 3600)
                minutes, seconds = divmod(remainder, 60)
                uptime_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                
            total_points = sum(s.channel_points for s in self.miner.streamers)
            online_count = sum(1 for s in self.miner.streamers if s.is_online)
            
            data = {
                "running": self.miner.running,
                "session_id": self.miner.session_id,
                "username": self.miner.username,
                "uptime": uptime_str,
                "total_points": total_points,
                "total_streamers": len(self.miner.streamers),
                "online_streamers": online_count,
                "ws_pool_size": len(self.miner.ws_pool.ws) if self.miner.ws_pool else 0
            }
            return Response(json.dumps(data), status=200, mimetype="application/json")

        def get_followers_list():
            if not self.miner or not self.miner.twitch:
                return Response(json.dumps({"error": "Minerador não inicializado ou sem instância do Twitch"}), status=400, mimetype="application/json")
            try:
                followers = self.miner.twitch.get_followers()
                return Response(json.dumps(followers), status=200, mimetype="application/json")
            except Exception as e:
                logger.error(f"Erro ao buscar seguidores: {e}")
                return Response(json.dumps({"error": str(e)}), status=500, mimetype="application/json")

        self.app = Flask(
            __name__,
            template_folder=os.path.join(Path().absolute(), "assets"),
            static_folder=os.path.join(Path().absolute(), "assets"),
        )
        self.app.add_url_rule(
            "/",
            "index",
            index,
            defaults={"refresh": refresh, "days_ago": days_ago},
            methods=["GET"],
        )
        self.app.add_url_rule("/streamers", "streamers",
                              streamers, methods=["GET"])
        self.app.add_url_rule(
            "/json/<string:streamer>", "json", read_json, methods=["GET"]
        )
        self.app.add_url_rule("/json_all", "json_all",
                              json_all, methods=["GET"])
        self.app.add_url_rule(
            "/log", "log", generate_log, methods=["GET"])
        
        self.app.add_url_rule(
            "/api/streamers_config", "get_streamers_config", get_streamers_config, methods=["GET"]
        )
        self.app.add_url_rule(
            "/api/streamers_config", "save_streamers_config", save_streamers_config, methods=["POST"]
        )
        self.app.add_url_rule(
            "/api/miner_status", "get_miner_status", get_miner_status, methods=["GET"]
        )
        self.app.add_url_rule(
            "/api/followers", "get_followers_list", get_followers_list, methods=["GET"]
        )

    def run(self):
        logger.info(
            f"Analytics running on http://{self.host}:{self.port}/",
            extra={"emoji": ":globe_with_meridians:"},
        )
        self.app.run(host=self.host, port=self.port,
                     threaded=True, debug=False)
