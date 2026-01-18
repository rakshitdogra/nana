const dropZone = document.querySelector('#dropZone');
const fileInput = document.querySelector('#pdfInput');
const fileList = document.querySelector('#fileList');
const analyzeBtn = document.querySelector('#analyzeBtn');
const statusText = document.querySelector('#statusText');
const resultsEl = document.querySelector('#results');
const template = document.querySelector('#resultTemplate');
const browseBtn = document.querySelector('#browseBtn');
const themeToggle = document.querySelector('#themeToggle');
const logoutBtn = document.querySelector('#logoutBtn');
const userGreeting = document.querySelector('#userGreeting');
const downloadReportBtn = document.querySelector('#downloadReportBtn');

let files = [];
let currentUser = null;
let analysisResults = [];
let authToken = localStorage.getItem('authToken');

function bytesToSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}


function renderFileList() {
  fileList.innerHTML = '';

  if (files.length === 0) {
    return;
  }

  files.forEach((file, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${file.name}</span>
      <small>${bytesToSize(file.size)}</small>
      <button type="button" data-index="${index}">Remove</button>
    `;
    li.querySelector('button').addEventListener('click', () => {
      files.splice(index, 1);
      renderFileList();
      toggleAnalyzeDisabled();
    });
    fileList.appendChild(li);
  });
}

function toggleAnalyzeDisabled() {
  analyzeBtn.disabled = files.length === 0;
}

function handleFiles(selectedFiles) {
  const fileArray = Array.from(selectedFiles);
  const limitedFiles = fileArray.slice(0, 5 - files.length);
  files = files.concat(limitedFiles);
  renderFileList();
  toggleAnalyzeDisabled();
}

function setStatus(message, tone = 'muted') {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

async function analyze() {
  const formData = new FormData();
  files.forEach((file) => formData.append('papers', file));

  analyzeBtn.disabled = true;
  setStatus('Uploading & parsing…', 'active');

  try {
    const headers = {};
    if (authToken) {
      headers['Authorization'] = 'Bearer ' + authToken;
    }

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: headers,
      body: formData,
    });

    if (response.status === 401) {
      handleAuthRedirect();
      return;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      if (response.status === 401) {
        handleAuthRedirect();
        return;
      }
      throw new Error(error.error || 'Something went wrong');
    }

    const payload = await response.json();
    analysisResults = payload.results;
    renderResults(payload.results);
    setStatus('Done', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  } finally {
    analyzeBtn.disabled = files.length === 0;
  }
}

function renderResults(results) {
  resultsEl.innerHTML = '';

  if (!results || results.length === 0) {
    resultsEl.innerHTML = '<div class="placeholder"><p>No results returned.</p></div>';
    downloadReportBtn.style.display = 'none';
    return;
  }

  // Show download button if we have results
  downloadReportBtn.style.display = 'block';

  results.forEach((result) => {
    const card = template.content.cloneNode(true);
    const paperName = card.querySelector('.paper-name');
    const meta = card.querySelector('.meta');
    const txtLink = card.querySelector('.text-link');
    const summary = card.querySelector('.summary');
    const bulletList = card.querySelector('.bullets');
    const limitations = card.querySelector('.limitations');
    const novelty = card.querySelector('.novelty');
    const questions = card.querySelector('.questions');

    paperName.textContent = result.originalName;
    meta.textContent = `${result.pages || '?'} pages · ${result.characters || 0} chars`;

    if (!result.textContent) {
      txtLink.remove();
    }

    let summaryData = coerceSummary(result.summary);
    if (summaryData.warning) {
      summary.textContent = summaryData.warning;
    } else if (summaryData.concise_summary) {
      summary.textContent = summaryData.concise_summary;
    } else if (summaryData.unparsed_summary) {
      summary.textContent = summaryData.unparsed_summary;
    } else {
      summary.textContent = 'No summary available.';
    }

    const keyPoints = Array.isArray(summaryData.key_points) ? summaryData.key_points : [];
    bulletList.innerHTML = keyPoints.map((point) => `<li>${point}</li>`).join('') || '<li>—</li>';

    limitations.textContent = summaryData.limitations || 'Not specified.';
    novelty.textContent = summaryData.novelty || 'Not specified.';

    const nextQuestions = Array.isArray(summaryData.next_questions) ? summaryData.next_questions : [];
    questions.innerHTML = nextQuestions.map((q) => `<li>${q}</li>`).join('') || '<li>—</li>';

    if (result.status === 'failed') {
      card.querySelector('.result-card').classList.add('error');
      summary.textContent = result.error || 'Failed to process this PDF.';
    }

    resultsEl.appendChild(card);
  });
}

function coerceSummary(summary) {
  if (!summary) return {};
  if (typeof summary === 'object') return summary;
  if (typeof summary === 'string') {
    try {
      return JSON.parse(summary);
    } catch (error) {
      return { unparsed_summary: summary };
    }
  }
  return {};
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    preventDefaults(e);
    dropZone.classList.add('dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    preventDefaults(e);
    dropZone.classList.remove('dragging');
  });
});

dropZone.addEventListener('drop', (e) => {
  preventDefaults(e);
  const dt = e.dataTransfer;
  if (!dt) return;
  handleFiles(dt.files);
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  
  // Delay clearing the input value to ensure files are processed first
  setTimeout(() => {
    e.target.value = '';
  }, 100);
});

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropZone.addEventListener('click', (e) => {
  // Only trigger file input if the click is not on the browse button
  if (e.target.id !== 'browseBtn' && !browseBtn.contains(e.target)) {
    fileInput.click();
  }
});

dropZone.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});

analyzeBtn.addEventListener('click', analyze);
themeToggle.addEventListener('click', toggleTheme);
logoutBtn?.addEventListener('click', logout);
downloadReportBtn?.addEventListener('click', downloadReport);

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  themeToggle.textContent = next === 'light' ? '🌙' : '☀️';
  localStorage.setItem('gps-theme', next);
}

function hydrateTheme() {
  const saved = localStorage.getItem('gps-theme');
  const theme = saved || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
}

async function hydrateSession() {
  try {
    const response = await fetch('/session');
    if (response.status === 401) {
      handleAuthRedirect();
      return;
    }
    if (!response.ok) {
      handleAuthRedirect();
      return;
    }
    const data = await response.json();
    currentUser = data.user;
    if (userGreeting) {
      userGreeting.textContent = `Hi, ${currentUser.name}`;
    }
  } catch (error) {
    console.error(error);
    handleAuthRedirect();
  }
}

function handleAuthRedirect() {
  window.location.href = '/';
}

async function logout() {
  logoutBtn.disabled = true;
  try {
    await fetch('/sessions/logout', { method: 'POST' });
  } finally {
    // Clear token for Vercel deployment
    localStorage.removeItem('authToken');
    authToken = null;
    handleAuthRedirect();
  }
}

function generateReportText(results) {
  if (!results || results.length === 0) {
    return 'No analysis results available.';
  }

  let report = '='.repeat(80) + '\n';
  report += '                    PAPER ANALYSIS REPORT\n';
  report += '='.repeat(80) + '\n\n';
  report += `Generated on: ${new Date().toLocaleString()}\n`;
  report += `Total Papers Analyzed: ${results.length}\n\n`;
  report += '-'.repeat(80) + '\n\n';

  results.forEach((result, index) => {
    const summaryData = coerceSummary(result.summary);
    
    report += `${index + 1}. ${result.originalName}\n`;
    report += '='.repeat(60) + '\n';
    
    // File metadata
    report += `File Information:\n`;
    report += `  • Pages: ${result.pages || 'Unknown'}\n`;
    report += `  • Characters: ${result.characters?.toLocaleString() || 'Unknown'}\n\n`;
    
    // Concise Summary
    report += `CONCISE SUMMARY:\n`;
    report += '-'.repeat(20) + '\n';
    if (summaryData.warning) {
      report += `${summaryData.warning}\n`;
    } else if (summaryData.concise_summary) {
      report += `${summaryData.concise_summary}\n`;
    } else if (summaryData.unparsed_summary) {
      report += `${summaryData.unparsed_summary}\n`;
    } else {
      report += 'No summary available.\n';
    }
    report += '\n';
    
    // Key Points
    const keyPoints = Array.isArray(summaryData.key_points) ? summaryData.key_points : [];
    report += `KEY POINTS:\n`;
    report += '-'.repeat(15) + '\n';
    if (keyPoints.length > 0) {
      keyPoints.forEach((point, i) => {
        report += `  ${i + 1}. ${point}\n`;
      });
    } else {
      report += '  • No key points identified.\n';
    }
    report += '\n';
    
    // Novelty
    report += `NOVELTY:\n`;
    report += '-'.repeat(12) + '\n';
    report += `${summaryData.novelty || 'No novelty assessment provided.'}\n\n`;
    
    // Limitations
    report += `LIMITATIONS:\n`;
    report += '-'.repeat(16) + '\n';
    report += `${summaryData.limitations || 'No limitations identified.'}\n\n`;
    
    // Next Questions
    const nextQuestions = Array.isArray(summaryData.next_questions) ? summaryData.next_questions : [];
    report += `NEXT QUESTIONS FOR RESEARCH:\n`;
    report += '-'.repeat(30) + '\n';
    if (nextQuestions.length > 0) {
      nextQuestions.forEach((question, i) => {
        report += `  ${i + 1}. ${question}\n`;
      });
    } else {
      report += '  • No next questions suggested.\n';
    }
    report += '\n';
    
    // Add separator between papers (except after last one)
    if (index < results.length - 1) {
      report += '\n' + '='.repeat(80) + '\n\n';
    }
  });
  
  report += '\n' + '='.repeat(80) + '\n';
  report += '                    END OF REPORT\n';
  report += '='.repeat(80) + '\n';
  
  return report;
}

function downloadReport() {
  if (!analysisResults || analysisResults.length === 0) {
    setStatus('No results to download', 'error');
    return;
  }
  
  try {
    const reportText = generateReportText(analysisResults);
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `paper-analysis-report-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setStatus('Report downloaded successfully', 'success');
  } catch (error) {
    console.error('Download error:', error);
    setStatus('Failed to download report', 'error');
  }
}

hydrateTheme();
hydrateSession();
