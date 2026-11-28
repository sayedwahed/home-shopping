"""Publisher registry (system 12): the five official-API publishers."""

from publishers.base import Publisher


class BloggerPublisher(Publisher):
    name = "blogger"
    label = "Blogger"
    required_env = ["BLOGGER_API_KEY", "BLOGGER_BLOG_ID"]


class PinterestPublisher(Publisher):
    name = "pinterest"
    label = "Pinterest"
    required_env = ["PINTEREST_ACCESS_TOKEN", "PINTEREST_BOARD_ID"]


class TikTokPublisher(Publisher):
    name = "tiktok"
    label = "TikTok"
    required_env = ["TIKTOK_ACCESS_TOKEN"]


class YouTubePublisher(Publisher):
    name = "youtube"
    label = "YouTube"
    required_env = ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"]


class XPublisher(Publisher):
    name = "x"
    label = "X (Twitter)"
    required_env = ["X_API_KEY", "X_API_SECRET",
                    "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]


ALL_PUBLISHERS = [
    BloggerPublisher(),
    PinterestPublisher(),
    TikTokPublisher(),
    YouTubePublisher(),
    XPublisher(),
]


def get_publisher(name):
    for pub in ALL_PUBLISHERS:
        if pub.name == name:
            return pub
    return None


def status_list():
    """[{name, label, status, missing_env}] for the admin page."""
    return [{
        "name": pub.name,
        "label": pub.label,
        "status": pub.status(),
        "missing_env": pub.missing_env(),
    } for pub in ALL_PUBLISHERS]
