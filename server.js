require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const upload = multer({ dest: 'uploads/' });

// CORS – Tüm originlere izin ver (geçici)
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// 5 farklı GEMINI API anahtarı
const GEMINI_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5
].filter(key => key);

console.log(`🚀 ${GEMINI_KEYS.length} adet Gemini API anahtarı yüklendi`);

// System prompt
const SYSTEM_PROMPT = `Sen Quea 1.0'sun. Kaya Studios tarafından geliştirildin. 
Cevaplarında kesinlikle * veya ** işareti kullanma. Kalın yazı kullanma. 
Madde işaretleri için - kullanabilirsin. Kod bloklarını \`\`\` ile belirt. 
Kullanıcıyla sohbet ederken önceki mesajları dikkate al.`;

// Cevap temizleme
function cleanResponse(text) {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = [];
    let cleanedText = text.replace(codeBlockRegex, (match) => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });
    
    cleanedText = cleanedText.replace(/\*/g, '');
    
    codeBlocks.forEach((block, index) => {
        cleanedText = cleanedText.replace(`__CODE_BLOCK_${index}__`, block);
    });
    
    return cleanedText;
}

// Gemini'ye istek at - failover
async function callGeminiWithFallback(prompt, dosya = null) {
    let lastError = null;
    
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const apiKey = GEMINI_KEYS[i];
        console.log(`🔑 Gemini API anahtarı ${i + 1} deneniyor...`);
        
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            
            let result;
            if (dosya && dosya.mimetype.startsWith('image/')) {
                const imageBuffer = fs.readFileSync(dosya.path);
                const base64Image = imageBuffer.toString('base64');
                
                result = await model.generateContent([
                    prompt,
                    {
                        inlineData: {
                            data: base64Image,
                            mimeType: dosya.mimetype
                        }
                    }
                ]);
            } else {
                result = await model.generateContent(prompt);
            }
            
            console.log(`✅ Gemini API anahtarı ${i + 1} başarılı!`);
            return result.response.text();
            
        } catch (error) {
            console.error(`❌ Gemini API anahtarı ${i + 1} başarısız:`, error.message);
            lastError = error;
        }
    }
    
    throw new Error(`Tüm Gemini API anahtarları başarısız. Son hata: ${lastError?.message}`);
}

// API endpoint
app.post('/api/sor', upload.single('dosya'), async (req, res) => {
    try {
        const { soru, messages } = req.body;
        const dosya = req.file;

        if (!soru && !dosya) {
            return res.status(400).json({ success: false, error: 'Soru veya dosya gerekli' });
        }

        let parsedMessages = [];
        if (messages) {
            try {
                parsedMessages = JSON.parse(messages);
            } catch (e) {
                console.warn('Mesajlar parse edilemedi, boş geçmiş kullanılacak.');
            }
        }

        // Prompt oluştur
        let prompt = SYSTEM_PROMPT + '\n\n### Sohbet Geçmişi:\n';

        parsedMessages.forEach(msg => {
            const rol = msg.role === 'user' ? 'Kullanıcı' : 'Quea';
            prompt += `${rol}: ${msg.content}\n`;
        });

        prompt += `\nKullanıcı: ${soru || '(dosya eklendi)'}\nQuea:`;

        const cevap = await callGeminiWithFallback(prompt, dosya);
        const cleanedCevap = cleanResponse(cevap);

        if (dosya) fs.unlinkSync(dosya.path);

        res.json({ success: true, mukemmelCevap: cleanedCevap });

    } catch (error) {
        console.error('❌ Backend hatası:', error);
        if (req.file) fs.unlinkSync(req.file.path);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        apiKeys: GEMINI_KEYS.length,
        message: 'Quea 1.0 çalışıyor' 
    });
});

// Tüm yolları index.html'e yönlendir (SPA)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Quea 1.0 http://localhost:${PORT} adresinde aktif!`));
