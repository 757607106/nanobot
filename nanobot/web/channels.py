"""Channel management helpers for the nanobot Web UI."""

from __future__ import annotations

from typing import Any

from nanobot.config.schema import ChannelsConfig, Config

GLOBAL_CHANNEL_KEYS = {"sendProgress", "sendToolHints"}
DEFAULT_CHANNELS_PAYLOAD = ChannelsConfig().model_dump(mode="json", by_alias=True)
CHANNEL_NAMES = [name for name in DEFAULT_CHANNELS_PAYLOAD if name not in GLOBAL_CHANNEL_KEYS]

CHANNEL_REQUIRED_FIELDS: dict[str, list[str]] = {
    "telegram": ["token", "allowFrom"],
    "whatsapp": ["bridgeUrl", "allowFrom"],
    "discord": ["token", "allowFrom"],
    "qq": ["appId", "secret", "allowFrom"],
    "slack": ["botToken", "appToken", "allowFrom"],
    "matrix": ["accessToken", "userId", "allowFrom"],
    "feishu": ["appId", "appSecret", "allowFrom"],
    "dingtalk": ["clientId", "clientSecret", "allowFrom"],
    "wecom": ["botId", "secret", "allowFrom"],
    "mochat": ["clawToken", "agentUserId", "allowFrom"],
    "email": [
        "consentGranted",
        "imapHost",
        "imapUsername",
        "imapPassword",
        "smtpHost",
        "smtpUsername",
        "smtpPassword",
        "fromAddress",
        "allowFrom",
    ],
}


class WebChannelService:
    """Builds channel overview/detail payloads from the current config."""

    def list_channels(self, *, config: Config) -> dict[str, Any]:
        channels_payload = config.channels.model_dump(mode="json", by_alias=True)
        return {
            "delivery": self._delivery_payload(channels_payload),
            "items": [
                self._build_channel_item(name, channels_payload.get(name))
                for name in CHANNEL_NAMES
            ],
        }

    def get_channel(self, *, config: Config, channel_name: str) -> dict[str, Any]:
        if channel_name not in CHANNEL_NAMES:
            raise KeyError(channel_name)

        channels_payload = config.channels.model_dump(mode="json", by_alias=True)
        raw_config = channels_payload.get(channel_name)
        return {
            "delivery": self._delivery_payload(channels_payload),
            "channel": self._build_channel_item(channel_name, raw_config),
            "config": raw_config if isinstance(raw_config, dict) else {},
        }

    def update_channel(
        self,
        *,
        channel_name: str,
        payload: dict[str, Any],
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        if channel_name not in CHANNEL_NAMES:
            raise KeyError(channel_name)
        if not isinstance(payload, dict):
            raise ValueError("Channel payload must be an object.")

        config_payload = dict(current_config)
        channels_payload = config_payload.setdefault("channels", {})
        existing_payload = channels_payload.get(channel_name)
        merged_payload = dict(existing_payload) if isinstance(existing_payload, dict) else {}
        merged_payload.update(payload)
        channels_payload[channel_name] = merged_payload

        updated_config = update_config(config_payload)
        return self.get_channel(
            config=_config_from_payload(updated_config),
            channel_name=channel_name,
        )

    def update_delivery(
        self,
        *,
        payload: dict[str, Any],
        current_config: dict[str, Any],
        update_config,
    ) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Delivery payload must be an object.")
        if "sendProgress" not in payload and "sendToolHints" not in payload:
            raise ValueError("At least one delivery setting is required.")

        config_payload = dict(current_config)
        channels_payload = config_payload.setdefault("channels", {})
        if "sendProgress" in payload:
            channels_payload["sendProgress"] = bool(payload.get("sendProgress"))
        if "sendToolHints" in payload:
            channels_payload["sendToolHints"] = bool(payload.get("sendToolHints"))

        updated_config = update_config(config_payload)
        return self.list_channels(config=_config_from_payload(updated_config))

    def _delivery_payload(self, channels_payload: dict[str, Any]) -> dict[str, bool]:
        return {
            "sendProgress": bool(channels_payload.get("sendProgress", True)),
            "sendToolHints": bool(channels_payload.get("sendToolHints", False)),
        }

    def _build_channel_item(self, channel_name: str, raw_config: Any) -> dict[str, Any]:
        config_payload = raw_config if isinstance(raw_config, dict) else {}
        default_payload = DEFAULT_CHANNELS_PAYLOAD.get(channel_name, {})
        required_fields = CHANNEL_REQUIRED_FIELDS.get(channel_name, [])
        missing_required_fields = [
            field
            for field in required_fields
            if not _has_value(config_payload.get(field))
        ]
        touched = _is_touched(config_payload, default_payload)
        enabled = bool(config_payload.get("enabled"))

        if enabled and missing_required_fields:
            status = "incomplete"
            status_label = "待补全"
            status_detail = f"已启用，但还缺少 {len(missing_required_fields)} 个关键字段。"
        elif enabled:
            status = "enabled"
            status_label = "已启用"
            status_detail = "已启用，当前实例会在运行时加载这个渠道。"
        elif not missing_required_fields and required_fields:
            status = "configured"
            status_label = "已配置"
            status_detail = "配置已保存，启用后即可开始接收消息。"
        elif touched:
            status = "incomplete"
            status_label = "待补全"
            status_detail = "已保存部分配置，但还不能稳定启用。"
        else:
            status = "unconfigured"
            status_label = "未配置"
            status_detail = "尚未填写这个渠道的接入信息。"

        return {
            "name": channel_name,
            "enabled": enabled,
            "configured": status in {"configured", "enabled"},
            "touched": touched,
            "status": status,
            "statusLabel": status_label,
            "statusDetail": status_detail,
            "missingRequiredFields": missing_required_fields,
        }


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


def _is_touched(config_payload: dict[str, Any], default_payload: dict[str, Any]) -> bool:
    keys = set(config_payload.keys()) | set(default_payload.keys())
    for key in keys:
        if config_payload.get(key) != default_payload.get(key):
            return True
    return False


def _config_from_payload(payload: dict[str, Any]) -> Config:
    return Config.model_validate(payload)
