from V3_updates import send_whatsapp_chunked

__all__ = ["send_whatsapp_chunked", "notify"]


async def notify(message: str):
    """Async wrapper around send_whatsapp_chunked for callers that prefer await."""
    send_whatsapp_chunked(message)
