# ──────────────────────────────────────────────
#  ROBSON — Servidor TTS (edge-tts)
#  Porta: 5500
#  Voz: pt-BR-AntonioNeural (masculina)
#  Inicie com: python tts_server.py
# ──────────────────────────────────────────────

import asyncio
import io
import sys

import edge_tts
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ── Config ──
TTS_PORT  = 5500
TTS_VOICE = "pt-BR-AntonioNeural"     # voz neural MASCULINA PT-BR
TTS_RATE  = "+5%"                      # ritmo natural masculino
TTS_PITCH = "-3Hz"                     # tom levemente mais grave

# ── App ──
app = FastAPI(title="ROBSON TTS Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # permite chamadas do browser (file://)
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

class TTSRequest(BaseModel):
    text: str
    voice: str = TTS_VOICE
    rate: str  = TTS_RATE
    pitch: str = TTS_PITCH

# ── Endpoint principal ──
@app.post("/speak")
async def speak(req: TTSRequest):
    """Recebe texto, retorna áudio MP3 via edge-tts."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Texto vazio.")

    # Limpa o texto para TTS (remove markdown, URLs etc.)
    clean = (
        req.text
        .replace("*", "").replace("_", "").replace("`", "")
        .replace("#", "").replace(">", "").replace("[", "").replace("]", "")
        .strip()
    )
    if not clean:
        raise HTTPException(status_code=400, detail="Texto inválido após limpeza.")

    try:
        communicate  = edge_tts.Communicate(clean, req.voice, rate=req.rate, pitch=req.pitch)
        audio_buffer = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])

        audio_buffer.seek(0)

        if audio_buffer.getbuffer().nbytes == 0:
            raise HTTPException(status_code=500, detail="Sem áudio gerado.")

        return StreamingResponse(
            audio_buffer,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-cache", "X-Voice": req.voice},
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"edge-tts erro: {str(e)}")


# ── Health check ──
@app.get("/health")
async def health():
    return {
        "status": "online",
        "voice":  TTS_VOICE,
        "rate":   TTS_RATE,
        "pitch":  TTS_PITCH,
    }


# ── Wake endpoint (chamado pelo frontend na inicialização) ──
@app.get("/wake")
async def wake():
    """Frontend chama este endpoint para confirmar que o servidor está ativo."""
    print("🔔  Wake-up ping recebido do frontend.")
    return {
        "status": "awake",
        "voice":  TTS_VOICE,
        "port":   TTS_PORT,
    }


# ── Start ──
if __name__ == "__main__":
    print("\n🎙  ROBSON TTS Server")
    print(f"    Voz  : {TTS_VOICE}  [MASCULINO]")
    print(f"    Porta: http://localhost:{TTS_PORT}")
    print("    Mantenha esta janela aberta enquanto usa o ROBSON.\n")

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=TTS_PORT,
        log_level="warning",   # silencioso — só erros aparecem
    )
