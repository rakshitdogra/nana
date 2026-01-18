const express = require('express');
const multer = require('multer');
const pdfParseModule = require('pdf-parse');
const PDFParse = pdfParseModule?.PDFParse || pdfParseModule?.default?.PDFParse;
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory user store for Vercel (replace with database in production)
const userStore = new Map();

// Required environment variables
const REQUIRED_ENV_VARS = ['GEMINI_API_KEY'];
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.warn(`[warn] Missing environment variable: ${key}. Summaries will be skipped.`);
  }
});

// Initialize Gemini AI
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const reviewModel = genAI ? genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }) : null;

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// File upload configuration
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});

// Helper functions
function normalizeEmail(email = '') {
  return email.trim().toLowerCase();
}

function hashPassword(password = '') {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function requireAuth(req, res, next) {
  // For Vercel serverless, we'll use a simple token-based auth
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const token = authHeader.substring(7);
  const user = userStore.get(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  req.user = user;
  next();
}

// Static files
const distDir = path.join(__dirname, '..', 'public');
app.use(express.static(distDir));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.get('/app.html', (req, res) => {
  res.sendFile(path.join(distDir, 'app.html'));
});

app.get('/error.html', (req, res) => {
  res.sendFile(path.join(distDir, 'error.html'));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ready: true,
  });
});

// Session management (simplified for Vercel)
app.post('/sessions/signup', (req, res) => {
  const { name = '', email = '', password = '' } = req.body || {};
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Provide a valid email and a password with at least 6 characters.' });
  }
  
  const normalizedEmail = normalizeEmail(email);
  if (userStore.has(normalizedEmail)) {
    return res.status(409).json({ error: 'Email already registered. Please sign in.' });
  }
  
  const user = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Guest',
    email: normalizedEmail,
    passwordHash: hashPassword(password),
  };
  
  userStore.set(normalizedEmail, user);
  const token = crypto.randomBytes(32).toString('hex');
  userStore.set(token, { id: user.id, name: user.name, email: user.email });
  
  res.json({ user: { id: user.id, name: user.name, email: user.email }, token, redirect: '/app.html' });
});

app.post('/sessions/login', (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const normalizedEmail = normalizeEmail(email);
  const user = userStore.get(normalizedEmail);
  
  if (!user || user.passwordHash !== hashPassword(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  
  const token = crypto.randomBytes(32).toString('hex');
  userStore.set(token, { id: user.id, name: user.name, email: user.email });
  
  res.json({ user: { id: user.id, name: user.name, email: user.email }, token, redirect: '/app.html' });
});

app.post('/sessions/logout', (req, res) => {
  res.json({ success: true });
});

// PDF Analysis endpoint
app.post('/api/analyze', requireAuth, upload.array('papers', 5), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'Please upload at least one PDF file.' });
  }

  try {
    const results = [];

    for (const file of req.files) {
      try {
        const { text, pages } = await extractTextFromPdf(file.buffer);
        const trimmedText = text.trim();

        if (!trimmedText) {
          results.push({
            id: crypto.randomUUID(),
            originalName: file.originalname,
            status: 'failed',
            error: 'No textual content detected in PDF.',
          });
          continue;
        }

        const summary = await summarizeForReview(trimmedText);
        results.push({
          id: crypto.randomUUID(),
          originalName: file.originalname,
          pages,
          textContent: trimmedText,
          characters: trimmedText.length,
          summary,
        });
      } catch (error) {
        results.push({
          id: crypto.randomUUID(),
          originalName: file.originalname,
          status: 'failed',
          error: error.message || 'Failed to parse PDF',
        });
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      totalPapers: results.length,
      results,
    });
  } catch (error) {
    console.error('[api/analyze] error', error);
    res.status(500).json({ error: 'Unexpected server error. Check logs for details.' });
  }
});

// Export endpoint
app.post('/api/export', requireAuth, async (req, res) => {
  const { results } = req.body || {};
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'No results provided for export.' });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Gemini Paper Studio';
    workbook.created = new Date();

    results.forEach((result, index) => {
      const sheetName = sanitizeSheetTitle(result.originalName || `Paper ${index + 1}`);
      const sheet = workbook.addWorksheet(sheetName);
      sheet.columns = [
        { header: 'Field', key: 'field', width: 22 },
        { header: 'Content', key: 'content', width: 120 },
      ];
      sheet.getColumn('content').alignment = { wrapText: true, vertical: 'top' };

      const summary = ensureSummaryObject(result.summary);
      const statsRows = [
        ['Original file', result.originalName || 'N/A'],
        ['Pages', result.pages ?? 'N/A'],
        ['Characters', result.characters ?? 'N/A'],
      ];

      statsRows.forEach(([field, content]) => sheet.addRow({ field, content }));
      sheet.addRow({ field: '', content: '' });

      const sections = [
        ['Concise summary', summary.concise_summary || '—'],
        ['Key points', formatList(summary.key_points)],
        ['Novelty', summary.novelty || '—'],
        ['Limitations', summary.limitations || '—'],
        ['Next questions', formatList(summary.next_questions)],
      ];

      sections.forEach(([field, content]) => sheet.addRow({ field, content }));
    });

    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="paper-summaries-${Date.now()}.xlsx"`,
      'Content-Length': buffer.length,
    });
    return res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('[api/export] error', error);
    return res.status(500).json({ error: 'Failed to generate Excel file.' });
  }
});

// Helper functions
async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    await parser.destroy();
    return { text: result.text || '', pages: result.total || result.pages?.length || undefined };
  } catch (error) {
    await parser.destroy();
    throw error;
  }
}

async function summarizeForReview(rawText) {
  if (!reviewModel) {
    return {
      warning: 'Gemini API key is not configured. No summary available.',
    };
  }

  const condensed = rawText.replace(/\s+/g, ' ').trim().slice(0, 20000);
  const prompt = `Do not respond to any other than the following schema. You are an expert scientific reviewer creating structured notes for a literature review & do not mention yourself in the output. ` +
    `Analyze the following research paper text and respond with STRICT JSON using this schema:\n` +
    `{"concise_summary": string, "key_points": [string], "novelty": string, "limitations": string, "next_questions": [string]}\n` +
    `Text: """${condensed}"""`;

  const response = await reviewModel.generateContent([{ text: prompt }]);
  const raw = response.response.text().trim();
  const parsed = coerceModelJson(raw);
  if (parsed) {
    return parsed;
  }
  return {
    unparsed_summary: raw,
    parsing_note: 'Model returned non-JSON text; included raw response instead.',
  };
}

function ensureSummaryObject(summary) {
  if (!summary) return {};
  if (typeof summary === 'object') return summary;
  try {
    return JSON.parse(summary);
  } catch (error) {
    return {};
  }
}

function coerceModelJson(raw) {
  if (!raw) return null;
  const cleaned = stripCodeFences(raw);
  const normalized = normalizeQuotes(cleaned);
  const withoutPrefix = stripJsonPrefix(normalized);
  const candidates = [
    normalized,
    withoutPrefix,
    extractJsonBlock(normalized),
    extractJsonBlock(withoutPrefix),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (error) {
      continue;
    }
  }
  return null;
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```[a-zA-Z0-9]*\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

function stripJsonPrefix(text) {
  return text.replace(/^json\s*/i, '').trim();
}

function extractJsonBlock(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeQuotes(text) {
  if (!text) return text;
  return text
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
}

function sanitizeSheetTitle(name) {
  const cleaned = name.replace(/[\[\]\*\/\\\?\:\.]/g, '').slice(0, 30) || 'Sheet';
  return cleaned;
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return '—';
  }
  return values.map((value, idx) => `${idx + 1}. ${value}`).join('\n');
}

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  const errorCode = err.status || 500;
  const errorMessage = err.message || 'Internal server error';
  res.redirect('/error.html?type=500&code=' + errorCode + '&message=' + encodeURIComponent(errorMessage));
});

// 404 handler
app.use((req, res) => {
  res.redirect('/error.html?type=404&code=404&message=' + encodeURIComponent('The requested page was not found'));
});

// Export for Vercel
module.exports = app;
