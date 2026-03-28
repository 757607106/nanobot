"""Channel connectivity checks for the nanobot Web UI."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import imaplib
import json
import smtplib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from nanobot.config.schema import Config
from nanobot.platform.instances import PlatformInstance, coerce_instance

CHANNEL_REQUIRED_FIELDS: dict[str, list[str]] = {
    "telegram": ["token"],
    "whatsapp": ["bridgeUrl"],
    "discord": ["token"],
    "qq": ["appId", "secret"],
    "slack": ["botToken", "appToken"],
    "matrix": ["accessToken", "userId"],
    "feishu": ["appId", "appSecret"],
    "dingtalk": ["clientId", "clientSecret"],
    "wecom": ["botId", "secret"],
    "mochat": ["clawToken", "agentUserId"],
    "email": [
        "consentGranted",
        "imapHost",
        "imapUsername",
        "imapPassword",
        "smtpHost",
        "smtpUsername",
        "smtpPassword",
        "fromAddress",
    ],
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _has_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value > 0
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list):
        return any(_has_value(item) for item in value)
    if isinstance(value, dict):
        return any(_has_value(item) for item in value.values())
    return value is not None


def _channel_payload(config: Config, channel_name: str) -> dict[str, Any]:
    channels_payload = config.channels.model_dump(mode="json", by_alias=True)
    raw = channels_payload.get(channel_name)
    return dict(raw) if isinstance(raw, dict) else {}


def _config_with_override(config: Config, channel_name: str, payload: dict[str, Any] | None) -> Config:
    if not payload:
        return config

    config_payload = config.model_dump(mode="json", by_alias=True)
    channels_payload = config_payload.setdefault("channels", {})
    current = channels_payload.get(channel_name)
    merged = dict(current) if isinstance(current, dict) else {}
    merged.update(payload)
    channels_payload[channel_name] = merged
    return Config.model_validate(config_payload)


class WebChannelTestService:
    """Runs lightweight connectivity checks for saved or draft channel config."""

    def __init__(self, instance: PlatformInstance | Path | None = None):
        self._instance = coerce_instance(instance)

    async def probe_channel(
        self,
        *,
        config: Config,
        channel_name: str,
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        checked_config = _config_with_override(config, channel_name, payload)
        channel_payload = _channel_payload(checked_config, channel_name)
        if not channel_payload and channel_name not in CHANNEL_REQUIRED_FIELDS:
            raise KeyError(channel_name)

        missing = [
            field
            for field in CHANNEL_REQUIRED_FIELDS.get(channel_name, [])
            if not _has_value(channel_payload.get(field))
        ]
        if missing:
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="配置还不完整，暂时不能发起连接测试。",
                detail=f"仍缺少：{'、'.join(missing)}",
                checks=[self._check("required_fields", "必填字段", "fail", f"缺少：{'、'.join(missing)}")],
            )

        probes = {
            "telegram": self._probe_telegram,
            "discord": self._probe_discord,
            "slack": self._probe_slack,
            "matrix": self._probe_matrix,
            "email": self._probe_email,
            "whatsapp": self._probe_whatsapp,
            "feishu": self._probe_feishu,
            "dingtalk": self._probe_dingtalk,
            "mochat": self._probe_mochat,
            "qq": self._probe_qq,
            "wecom": self._probe_wecom,
        }

        probe = probes.get(channel_name)
        if probe is None:
            raise KeyError(channel_name)
        return await probe(channel_name, channel_payload)

    def _check(self, key: str, label: str, status: str, detail: str) -> dict[str, str]:
        return {
            "key": key,
            "label": label,
            "status": status,
            "detail": detail,
        }

    def _result(
        self,
        *,
        channel_name: str,
        status: str,
        summary: str,
        detail: str | None = None,
        binding_required: bool = False,
        checks: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        label_map = {
            "passed": "测试通过",
            "warning": "需要处理",
            "failed": "测试失败",
            "manual": "需人工处理",
        }
        return {
            "channelName": channel_name,
            "status": status,
            "statusLabel": label_map[status],
            "summary": summary,
            "detail": detail,
            "bindingRequired": binding_required,
            "checkedAt": _now_iso(),
            "checks": checks or [],
        }

    async def _probe_manual(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        _ = channel_payload
        return self._result(
            channel_name=channel_name,
            status="manual",
            summary="当前渠道还没有接入自动测试。",
            detail="建议先保存配置，再按官方接入流程手动验证连通性。",
            checks=[self._check("manual", "人工验证", "warn", "自动测试待后续补齐。")],
        )

    async def _probe_telegram(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        token = str(channel_payload.get("token") or "").strip()
        proxy = str(channel_payload.get("proxy") or "").strip() or None
        url = f"https://api.telegram.org/bot{token}/getMe"
        async with httpx.AsyncClient(timeout=15.0, proxy=proxy) as client:
            response = await client.get(url)
        data = response.json()
        if not response.is_success or not data.get("ok"):
            description = str(data.get("description") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Telegram Token 校验失败。",
                detail=description,
                checks=[self._check("token", "Token 校验", "fail", description)],
            )

        bot = data.get("result") or {}
        username = str(bot.get("username") or "").strip()
        return self._result(
            channel_name=channel_name,
            status="passed",
            summary=f"Telegram Token 校验通过，已识别机器人 @{username or 'unknown'}。",
            detail="当前配置已经可以完成最小 Telegram API 探测。",
            checks=[self._check("token", "Token 校验", "pass", f"机器人用户名：@{username or 'unknown'}")],
        )

    async def _probe_discord(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        token = str(channel_payload.get("token") or "").strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                "https://discord.com/api/v10/users/@me",
                headers={"Authorization": f"Bot {token}"},
            )
        data = response.json() if response.content else {}
        if not response.is_success:
            detail = str(data.get("message") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Discord Bot Token 校验失败。",
                detail=detail,
                checks=[self._check("token", "Bot Token", "fail", detail)],
            )

        username = str(data.get("username") or "").strip()
        return self._result(
            channel_name=channel_name,
            status="passed",
            summary=f"Discord Bot Token 校验通过，机器人账号 {username or 'unknown'} 可用。",
            detail="已完成最小 REST API 身份校验。",
            checks=[self._check("token", "Bot Token", "pass", f"机器人账号：{username or 'unknown'}")],
        )

    async def _probe_slack(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        bot_token = str(channel_payload.get("botToken") or "").strip()
        app_token = str(channel_payload.get("appToken") or "").strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            bot_response = await client.post(
                "https://slack.com/api/auth.test",
                headers={"Authorization": f"Bearer {bot_token}"},
            )
            bot_data = bot_response.json()
            app_response = await client.post(
                "https://slack.com/api/apps.connections.open",
                headers={"Authorization": f"Bearer {app_token}"},
            )
            app_data = app_response.json()

        if not bot_response.is_success or not bot_data.get("ok"):
            detail = str(bot_data.get("error") or f"HTTP {bot_response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Slack Bot Token 校验失败。",
                detail=detail,
                checks=[self._check("bot_token", "Bot Token", "fail", detail)],
            )
        if not app_response.is_success or not app_data.get("ok"):
            detail = str(app_data.get("error") or f"HTTP {app_response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Slack App Token 校验失败。",
                detail=detail,
                checks=[
                    self._check("bot_token", "Bot Token", "pass", "Bot Token 可用。"),
                    self._check("app_token", "App Token", "fail", detail),
                ],
            )

        team = str(bot_data.get("team") or "").strip()
        return self._result(
            channel_name=channel_name,
            status="passed",
            summary=f"Slack 凭据校验通过，可接入团队 {team or 'unknown'}。",
            detail="Bot Token 和 Socket Mode App Token 都已通过最小探测。",
            checks=[
                self._check("bot_token", "Bot Token", "pass", "Bot Token 校验通过。"),
                self._check("app_token", "App Token", "pass", "Socket Mode App Token 校验通过。"),
            ],
        )

    async def _probe_matrix(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        homeserver = str(channel_payload.get("homeserver") or "https://matrix.org").strip().rstrip("/")
        access_token = str(channel_payload.get("accessToken") or "").strip()
        expected_user = str(channel_payload.get("userId") or "").strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{homeserver}/_matrix/client/v3/account/whoami",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        data = response.json() if response.content else {}
        if not response.is_success:
            detail = str(data.get("error") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Matrix Access Token 校验失败。",
                detail=detail,
                checks=[self._check("access_token", "Access Token", "fail", detail)],
            )

        actual_user = str(data.get("user_id") or "").strip()
        if expected_user and actual_user and expected_user != actual_user:
            return self._result(
                channel_name=channel_name,
                status="warning",
                summary="Matrix Token 可用，但返回的用户 ID 与当前配置不一致。",
                detail=f"当前配置：{expected_user}；实际返回：{actual_user}",
                checks=[self._check("whoami", "WhoAmI", "warn", f"实际用户：{actual_user}")],
            )

        return self._result(
            channel_name=channel_name,
            status="passed",
            summary=f"Matrix 凭据校验通过，用户 {actual_user or expected_user or 'unknown'} 可用。",
            detail="已完成 homeserver + access token 的最小探测。",
            checks=[self._check("whoami", "WhoAmI", "pass", f"用户：{actual_user or expected_user or 'unknown'}")],
        )

    async def _probe_email(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        result = await asyncio.to_thread(self._probe_email_sync, channel_payload)
        return self._result(
            channel_name=channel_name,
            status="passed",
            summary="邮箱 IMAP / SMTP 凭据校验通过。",
            detail="已完成登录与基础握手测试，尚未发送真实邮件。",
            checks=result,
        )

    def _probe_email_sync(self, channel_payload: dict[str, Any]) -> list[dict[str, str]]:
        checks: list[dict[str, str]] = []

        if bool(channel_payload.get("imapUseSsl", True)):
            imap = imaplib.IMAP4_SSL(
                str(channel_payload.get("imapHost") or "").strip(),
                int(channel_payload.get("imapPort") or 993),
                timeout=10,
            )
        else:
            imap = imaplib.IMAP4(
                str(channel_payload.get("imapHost") or "").strip(),
                int(channel_payload.get("imapPort") or 143),
                timeout=10,
            )
        try:
            imap.login(
                str(channel_payload.get("imapUsername") or "").strip(),
                str(channel_payload.get("imapPassword") or ""),
            )
            imap.logout()
            checks.append(self._check("imap", "IMAP 登录", "pass", "IMAP 登录成功。"))
        except Exception as exc:  # noqa: BLE001
            with contextlib.suppress(Exception):
                imap.logout()
            raise RuntimeError(f"IMAP 登录失败：{exc}") from exc

        smtp_host = str(channel_payload.get("smtpHost") or "").strip()
        smtp_port = int(channel_payload.get("smtpPort") or 587)
        smtp_username = str(channel_payload.get("smtpUsername") or "").strip()
        smtp_password = str(channel_payload.get("smtpPassword") or "")
        if bool(channel_payload.get("smtpUseSsl")):
            smtp = smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=10)
        else:
            smtp = smtplib.SMTP(smtp_host, smtp_port, timeout=10)
        try:
            smtp.ehlo()
            if bool(channel_payload.get("smtpUseTls", True)) and not bool(channel_payload.get("smtpUseSsl")):
                smtp.starttls()
                smtp.ehlo()
            smtp.login(smtp_username, smtp_password)
            smtp.quit()
            checks.append(self._check("smtp", "SMTP 登录", "pass", "SMTP 登录成功。"))
        except Exception as exc:  # noqa: BLE001
            with contextlib.suppress(Exception):
                smtp.quit()
            raise RuntimeError(f"SMTP 登录失败：{exc}") from exc

        return checks

    async def _probe_whatsapp(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        import websockets

        bridge_url = str(channel_payload.get("bridgeUrl") or "").strip()
        bridge_token = str(channel_payload.get("bridgeToken") or "").strip()
        async with websockets.connect(bridge_url, open_timeout=10, close_timeout=3) as ws:
            if bridge_token:
                await ws.send(json.dumps({"type": "auth", "token": bridge_token}))

        auth_dir = self._instance.runtime_dir("whatsapp-auth")
        binding_required = not any(auth_dir.iterdir())
        status = "warning" if binding_required else "passed"
        summary = "WhatsApp bridge 可连通。" if not binding_required else "WhatsApp bridge 可连通，但当前实例还未完成扫码绑定。"
        detail = "继续在页面里完成绑定流程会更合适。" if binding_required else "bridge 与本地认证目录都已可用。"
        return self._result(
            channel_name=channel_name,
            status=status,
            summary=summary,
            detail=detail,
            binding_required=binding_required,
            checks=[self._check("bridge", "Bridge 连通性", "pass", f"地址：{bridge_url}")],
        )

    async def _probe_feishu(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": str(channel_payload.get("appId") or "").strip(),
                    "app_secret": str(channel_payload.get("appSecret") or "").strip(),
                },
            )
        data = response.json() if response.content else {}
        if not response.is_success or int(data.get("code", 0)) != 0:
            detail = str(data.get("msg") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Feishu App 凭据校验失败。",
                detail=detail,
                checks=[self._check("tenant_token", "Tenant Access Token", "fail", detail)],
            )

        return self._result(
            channel_name=channel_name,
            status="passed",
            summary="Feishu App 凭据校验通过。",
            detail="Tenant access token 已成功获取。",
            checks=[self._check("tenant_token", "Tenant Access Token", "pass", "已成功获取 tenant token。")],
        )

    async def _probe_dingtalk(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.dingtalk.com/v1.0/oauth2/accessToken",
                json={
                    "appKey": str(channel_payload.get("clientId") or "").strip(),
                    "appSecret": str(channel_payload.get("clientSecret") or "").strip(),
                },
            )
        data = response.json() if response.content else {}
        if not response.is_success or not data.get("accessToken"):
            detail = str(data.get("message") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="钉钉应用凭据校验失败。",
                detail=detail,
                checks=[self._check("access_token", "Access Token", "fail", detail)],
            )

        return self._result(
            channel_name=channel_name,
            status="passed",
            summary="钉钉应用凭据校验通过。",
            detail="Access token 已成功获取。",
            checks=[self._check("access_token", "Access Token", "pass", "已成功获取 access token。")],
        )

    async def _probe_qq(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        if importlib.util.find_spec("botpy") is None:
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="QQ 自动测试不可用，当前环境缺少 botpy 依赖。",
                detail="请先安装 qq-botpy，再重新测试。",
                checks=[self._check("dependency", "botpy 依赖", "fail", "缺少 qq-botpy / botpy。")],
            )

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://bots.qq.com/app/getAppAccessToken",
                json={
                    "appId": str(channel_payload.get("appId") or "").strip(),
                    "clientSecret": str(channel_payload.get("secret") or "").strip(),
                },
            )
        data = response.json() if response.content else {}
        if not response.is_success or not data.get("access_token"):
            detail = str(data.get("message") or data.get("msg") or f"HTTP {response.status_code}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="QQ App 凭据校验失败。",
                detail=detail,
                checks=[self._check("access_token", "Access Token", "fail", detail)],
            )

        expires_in = str(data.get("expires_in") or "unknown")
        return self._result(
            channel_name=channel_name,
            status="passed",
            summary="QQ App 凭据校验通过。",
            detail="已成功获取 access token。",
            checks=[self._check("access_token", "Access Token", "pass", f"expires_in={expires_in}")],
        )

    async def _probe_wecom(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        sdk_available = importlib.util.find_spec("wecom_aibot_sdk") is not None
        if not sdk_available:
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="WeCom 自动测试不可用，当前环境缺少 wecom_aibot_sdk 依赖。",
                detail="请先安装 wecom_aibot_sdk，再重新测试。",
                checks=[self._check("dependency", "SDK 依赖", "fail", "缺少 wecom_aibot_sdk。")],
            )

        return self._result(
            channel_name=channel_name,
            status="warning",
            summary="WeCom 已满足最小启动条件，但官方 SDK 不提供独立轻量凭据探测。",
            detail="本次测试已完成依赖与字段预检，建议在真实环境里进一步验证 WebSocket 连接。",
            checks=[
                self._check("dependency", "SDK 依赖", "pass", "wecom_aibot_sdk 已安装。"),
                self._check("credentials", "凭据字段", "pass", "botId / secret 已填写。"),
            ],
        )

    async def _probe_mochat(self, channel_name: str, channel_payload: dict[str, Any]) -> dict[str, Any]:
        base_url = str(channel_payload.get("baseUrl") or "").strip().rstrip("/")
        claw_token = str(channel_payload.get("clawToken") or "").strip()
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                f"{base_url}/api/claw/sessions/list",
                headers={"Content-Type": "application/json", "X-Claw-Token": claw_token},
                json={},
            )
        data = response.json() if response.content else {}
        if not response.is_success:
            detail = f"HTTP {response.status_code}"
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Mochat 服务地址或 Claw Token 校验失败。",
                detail=detail,
                checks=[self._check("sessions_list", "Sessions API", "fail", detail)],
            )

        if isinstance(data, dict) and isinstance(data.get("code"), int) and data["code"] != 200:
            detail = str(data.get("message") or data.get("name") or f"code={data['code']}")
            return self._result(
                channel_name=channel_name,
                status="failed",
                summary="Mochat API 返回错误。",
                detail=detail,
                checks=[self._check("sessions_list", "Sessions API", "fail", detail)],
            )

        return self._result(
            channel_name=channel_name,
            status="passed",
            summary="Mochat 服务地址与 Claw Token 校验通过。",
            detail="已完成 sessions 列表接口探测。",
            checks=[self._check("sessions_list", "Sessions API", "pass", "列表接口可访问。")],
        )
