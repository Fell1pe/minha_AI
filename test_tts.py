import asyncio
import edge_tts
import os

async def test_tts():
    voice = "pt-BR-AntonioNeural"
    text = "Teste de áudio do sistema Robson. Se você está ouvindo isso, o motor de voz está funcionando."
    output_file = "test_audio.mp3"
    
    print(f"Gerando áudio com a voz: {voice}...")
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)
    
    if os.path.exists(output_file):
        size = os.path.getsize(output_file)
        print(f"Sucesso! Arquivo {output_file} gerado ({size} bytes).")
    else:
        print("Erro ao gerar o arquivo de áudio.")

if __name__ == "__main__":
    asyncio.run(test_tts())
