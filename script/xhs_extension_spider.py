# -*- coding: utf-8 -*-
"""
小红书 Extension 采集逻辑（Demo）
参考 xhs_pc_spider 结构，仅做案例演示。
"""
import os
import re
import uuid
import redis
import logging
import requests
import traceback
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


if os.path.exists("/home/code"):
    r = redis.Redis(host="10.45.6.242", port=6379, db=0, decode_responses=True)

    # 兴趣采集 关键词任务队列 collect_source_type: 2 websiteid: 551
    REDIS_KEY_KEYWORD_TASKS = "Interest:KeywordTasks:2:551"
    elice_host = "http://10.42.104.97:8766/"
    url_maa_router_pop_data = "elice/maa_router/pop"
else:
    r = redis.Redis(host="49.232.200.211", port=6380, db=0, decode_responses=True)

    # 兴趣采集 关键词任务队列 collect_source_type: 2 websiteid: 551
    REDIS_KEY_KEYWORD_TASKS = "Interest:KeywordTasks:2:551"
    elice_host = "https://cbd-front-itomms.smzdm.com/"
    url_maa_router_pop_data = "elice/maa_router/pop"



def get_trace_id():
    return str(uuid.uuid4()).replace("-", "")

def get_keyword_task():
    """获取搜索关键词(redis队列)

    Returns:
        str: _description_
    """
    params = {
        "key": REDIS_KEY_KEYWORD_TASKS,
        "count": 1,
    }
    headers = {
        "accept": "application/json",
    }
    resp = requests.get(
        f"{elice_host}{url_maa_router_pop_data}",
        params=params,
        headers=headers,
        verify=False,
    )
    return_data = resp.json()
    keyword = ""
    keyword_info = {}
    if return_data.get("code") == "0":
        keyword_infos = return_data.get("result", [{}])
        if keyword_infos:
            keyword_info = keyword_infos[0]
            keyword = keyword_info.get("Keywords")

    return keyword_info

def send_xhs_article_result(kw_info: dict, items: list):
    """发送关键词搜索结果

    Args:
        kw_info (dict): _description_
        items (list): _description_
    """
    params = {
        "trace_id": get_trace_id(),
    }

    kw_info["items"] = items

    resp = None
    result = {}
    try:
        headers = {
            "User-Agent": "WeRead/8.2.6 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 6 Build/TP1A.221105.002)",
        }
        resp = requests.post(
            f"{elice_host}",
            params=params,
            json=kw_info,
            headers=headers,
            verify=False,
            timeout=20,
        )
        result = resp.json()
        logger.info(f"resp_result: {result}\n\n")
    except Exception as e:
        logger.error(f"error: {traceback.format_exc()}")
        error_msg = f"发送关键词搜索结果失败，kw_info: {kw_info}"
        if resp:
            error_msg += f", html: {resp.text}"
        logger.error(f"{error_msg}\n\n")
        result = {
            "code": "-1",
            "message": "请求失败",
            "success": False,
            "result": "",
        }
    return result




def normalize_publish_time(text):
    """将小红书多种发布时间格式统一为 '%Y-%m-%d %H:%M:%S'。

    支持格式示例：昨天 22:49、1小时前、3分钟前、02-21、2026-03-01、今天 12:00、5天前 等。
    无法解析时返回原字符串（或空字符串）。
    """
    if not text or not isinstance(text, str):
        return text or ""
    text = text.strip()
    if not text:
        return ""

    now = datetime.now()

    # 昨天 22:49 / 今天 12:00
    m = re.match(r"^(昨天|今天)\s*(\d{1,2}):(\d{2})$", text)
    if m:
        day_label, h, mm = m.group(1), m.group(2), m.group(3)
        if day_label == "昨天":
            d = now.date() - timedelta(days=1)
        else:
            d = now.date()
        try:
            t = datetime.strptime(f"{h}:{mm}", "%H:%M").time()
            return datetime.combine(d, t).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            return text

    # X分钟前
    m = re.match(r"^(\d+)\s*分钟前$", text)
    if m:
        mins = int(m.group(1))
        dt = now - timedelta(minutes=mins)
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    # X小时前
    m = re.match(r"^(\d+)\s*小时前$", text)
    if m:
        hours = int(m.group(1))
        dt = now - timedelta(hours=hours)
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    # X天前（可选：带时间 如 2天前 12:30，这里仅支持 "X天前"）
    m = re.match(r"^(\d+)\s*天前$", text)
    if m:
        days = int(m.group(1))
        dt = now - timedelta(days=days)
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    # 完整日期 2026-03-01 / 2025-12-27
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)} 00:00:00"

    # 月-日 02-21
    m = re.match(r"^(\d{2})-(\d{2})$", text)
    if m:
        try:
            mm, dd = int(m.group(1)), int(m.group(2))
            dt = datetime(now.year, mm, dd)
            if dt.date() > now.date():
                dt = datetime(now.year - 1, mm, dd)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass

    return text


def parse_xhs_search_result(body):
    """解析小红书搜索列表消息体，提取笔记/视频列表。

    消息体可能是单条对象或数组 [{}]，且 data.items 中可能混有 note 与 hot_query 等类型。
    仅解析 model_type=='note' 的项，根据 note_card.type 区分 normal(图文笔记) / video(视频)。

    Args:
        body: 接口返回的原始 body，可为 list 或 dict。若为 list 取首元素。

    Returns:
        dict: 解析后的笔记列表，与 search_list_data 字段对齐。每项包含：
                    XsecToken, IsAds, PublishTime, ArticleType, ContentQty,
                    ThumbsUpQty, ReviewQty, CollectQty, ShareQty, Url，以及 note_id, title, cover_url, user_id, nickname。
    """
    if isinstance(body, list) and body:
        item = body[0]
    elif isinstance(body, dict):
        item = body
    else:
        return []

    if item.get("model_type") != "note":
        return {}
    note_card = item.get("note_card") or {}
    _type = note_card.get("type") or "normal"
    # normal=图文笔记, video=视频 -> ArticleType
    article_type = _type

    # 发布时间 PublishTime：从 corner_tag_info 里 type==publish_time 取 text，并转为 %Y-%m-%d %H:%M:%S
    publish_time_raw = ""
    for tag in (note_card.get("corner_tag_info") or []):
        if tag.get("type") == "publish_time":
            publish_time_raw = (tag.get("text") or "").strip()
            break
    publish_time = normalize_publish_time(publish_time_raw)

    cover = note_card.get("cover") or {}
    cover_url = cover.get("url_default") or cover.get("url_pre") or ""

    user = note_card.get("user") or {}
    user_id = user.get("user_id") or ""
    nickname = user.get("nick_name") or user.get("nickname") or ""

    interact = note_card.get("interact_info") or {}
    thumbs_up_qty = interact.get("liked_count") or "0"
    review_qty = interact.get("comment_count") or "0"
    collect_qty = interact.get("collected_count") or "0"
    share_qty = interact.get("shared_count") or "0"

    note_id = item.get("id") or ""
    xsec_token = item.get("xsec_token") or ""
    # 笔记详情页 URL（PC 端 feed 来源）
    url = f"https://www.xiaohongshu.com/explore/{note_id}" if note_id else ""
    return {
        "XsecToken": xsec_token,  # 小红书特有 token
        "IsAds": 0,  # 是否广告 小红书特有
        "PublishTime": publish_time,  # 发布时间
        "ArticleType": article_type,  # 文章类型
        # "ContentQty": -1,  # 内容长度 PC采集获取不到 不填写
        "ThumbsUpQty": thumbs_up_qty,  # 点赞数
        "ReviewQty": review_qty,  # 评论数
        "CollectQty": collect_qty,  # 收藏数
        "ShareQty": share_qty,  # 分享数
        "Url": url,
        # 以下为补充字段，便于业务使用
        # "note_id": note_id,
        # "title": (note_card.get("display_title") or ""),
        # "cover_url": cover_url,
        # "user_id": user_id,
        # "nickname": nickname,
    }

def add_xhs_app_search_result_test(body):
    """测试：向 add_xhs_app_search_result 接口发送 POST 请求"""
    url = f"elice/xhs_extension/add_xhs_app_search_result"
    params = {"trace_id": get_trace_id()}
    # 测试 body：关键词任务信息 + items（可为空或模拟数据）
    headers = {
        "User-Agent": "WeRead/8.2.6 WRBrand/other Dalvik/2.1.0 (Linux; U; Android 13; Pixel 6 Build/TP1A.221105.002)",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(
            url,
            params=params,
            json=body,
            headers=headers,
            verify=False,
            timeout=20,
        )
        result = resp.json()
        logger.info(f"add_xhs_app_search_result_test resp: {result}")
        return result
    except Exception as e:
        logger.error(f"add_xhs_app_search_result_test error: {traceback.format_exc()}")
        return {"code": "-1", "message": str(e), "success": False, "result": ""}


if __name__ == '__main__':
    # test: 获取小红书关键词队列
    # '无痛省钱小妙招：冲动消费克星',
    # {'ID': 19682217, 'InterestID': '2859421', 'InterestName': '省钱绝活', 'Keywords': '无痛省钱小妙招：冲动消费克星', 'Platform': '小红书', 'Type': 1, ...}
    # print(get_keyword_task())
    # test: 解析采集数据（可从 xhs_search_data.txt 或接口 body 读取）
    # import json
    # with open(os.path.join(os.path.dirname(__file__), "xhs_search_data.txt")) as f:
    #     bodys = json.load(f)
    #
    # for body in bodys:
    #     inner = body.get("data") or {}
    #     items = inner.get("items") or []
    #     for item in items:
    #         x = parse_xhs_search_result(item)
    #         if not x:
    #             continue
    #         result = {}
    #         result['XsecToken'] = x["XsecToken"]
    #         result['IsAds'] = x["IsAds"]
    #         result['PublishTime'] = x["PublishTime"]
    #         result['ArticleType'] = x["ArticleType"]
    #         result['ThumbsUpQty'] = x["ThumbsUpQty"]
    #         result['ReviewQty'] = x["ReviewQty"]
    #         result['CollectQty'] = x["CollectQty"]
    #         result['ShareQty'] = x["ShareQty"]
    #         result['Url'] = x["Url"]
    #         print(json.dumps(result, ensure_ascii=False, indent=10))
    # test: 时间解析
    # print(normalize_publish_time('1小时前'))
    # print(normalize_publish_time('1分钟前'))
    # print(normalize_publish_time('2026-01-03'))
    # print(normalize_publish_time('02-20'))
    # test: 发送接口
    key_body = get_keyword_task()
    import json
    with open(os.path.join(os.path.dirname(__file__), "xhs_search_data.txt")) as f:
        bodys = json.load(f)
    for body in bodys:
        inner = body.get("data") or {}
        items = inner.get("items") or []
        key_body['items'] = items
        add_xhs_app_search_result_test(body=key_body)

