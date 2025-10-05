// --- Gemini API Configuration ---
// IMPORTANT: The API key has been hardcoded as requested by the user. 
// In a real application, use environment variables for security.
const providedApiKey = "Enter Your Gemini API Key Here"; // <-- Replace with your actual API key
const apiKey = providedApiKey;
const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
const MAX_RETRIES = 5;

// --- DOM Elements ---
const codeInput = document.getElementById('code-input');
const languageSelector = document.getElementById('language-selector');
const modeSelector = document.getElementById('mode-selector');
const processButton = document.getElementById('process-button');
const outputPanel = document.getElementById('output-panel');
const loadingSpinner = document.getElementById('loading-spinner');
const buttonText = document.getElementById('button-text');
const errorMessage = document.getElementById('error-message');
const errorText = document.getElementById('error-text');

// --- Helper Functions for Prompts ---

const getSystemInstruction = (mode, language) => {
    switch (mode) {
        case 'explain':
            return `You are a professional code explainer. Your task is to provide a comprehensive, step-by-step breakdown of the provided ${language} code snippet.`;
        case 'debug':
            return `You are an expert debugger and static analysis tool. Your task is to rigorously analyze the provided ${language} code, identify any bugs, logical errors, or potential security vulnerabilities, and provide the definitive fix.`;
        case 'refactor':
            return `You are a world-class software architect. Your task is to review and refactor the provided ${language} code snippet for modern practices, performance, readability, and maintainability.`;
        default:
            return "You are a helpful coding assistant.";
    }
};

const getUserQuery = (mode, code) => {
    switch (mode) {
        case 'explain':
            return `Provide a concise summary, followed by a detailed, line-by-line explanation of the following code. Format your entire response strictly in clean, runnable Markdown.
---
${code}`;
        case 'debug':
            return `Identify the bug, explain the solution, and provide the complete, fixed code block (using markdown code fences) for the following snippet. Format your entire response strictly in clean, runnable Markdown.
---
${code}`;
        case 'refactor':
            return `Suggest modern refactoring changes to the following code. Explain your reasoning and provide the complete, clean, refactored code block (using markdown code fences). Format your entire response strictly in clean, runnable Markdown.
---
${code}`;
        default:
            return `Analyze the following code: ${code}`;
    }
};

/**
 * Renders Markdown content as proper HTML, focusing on reliability for code blocks, lists, and headings.
 * This function has been significantly improved for better visual output based on the user's feedback.
 * @param {string} markdownText - The Markdown text to render.
 */
const renderMarkdown = (markdownText) => {
    // Normalize newline characters
    let htmlText = markdownText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1. Handle Code Blocks (must be done first to protect content)
    // Replace ```[lang]\ncode\n``` with <pre><code>...</code></pre>
    htmlText = htmlText.replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
        const language = lang || 'text';
        return `<pre><code class="language-${language}">${code.trim()}</code></pre>\n`;
    });

    // 2. Headings (H1 and H2 - the most common)
    htmlText = htmlText.replace(/^##\s*(.*)$/gm, '<h2>$1</h2>');
    htmlText = htmlText.replace(/^#\s*(.*)$/gm, '<h1>$1</h1>');

    // 3. Horizontal Rule
    htmlText = htmlText.replace(/^-{3,}$/gm, '<hr>');

    // 4. Strong/Bold
    htmlText = htmlText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    htmlText = htmlText.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
    
    // 5. Unordered Lists (Must be done before paragraph wrapping)
    // Find list items starting with '*' or '-' at the start of a line (or after a newline)
    // Look for * or - followed by a space at the beginning of a line
    htmlText = htmlText.replace(/(^|\n)[\*\-]\s+(.*)$/gm, '$1<li>$2</li>');
    
    // Wrap consecutive <li> tags in <ul> tags
    htmlText = htmlText.replace(/(<li>[\s\S]*?<\/li>)/g, (match, content) => {
        if (content.trim().startsWith('<li>')) {
            // Check if the previous content was NOT the end of a list
            let before = htmlText.substring(0, htmlText.indexOf(match));
            if (!before.trim().endsWith('</ul>') && !before.trim().endsWith('</li>') && !before.trim().endsWith('<br>')) {
                return `<ul>${match}</ul>`;
            }
        }
        return match;
    });

    // Second pass for lists, replacing contiguous list items
    htmlText = htmlText.replace(/<\/ul>\s*<ul>/g, '');


    // 6. Paragraphs and Line Breaks
    // Replace two or more consecutive newlines with a paragraph closer/opener.
    htmlText = htmlText.replace(/\n{2,}/g, '</p><p>');
    // Replace single newlines with a <br>
    htmlText = htmlText.replace(/\n/g, '<br>');

    // 7. Final cleanup and wrapping
    // Remove leading/trailing <br> tags.
    htmlText = htmlText.replace(/<br>$/, '').replace(/^<br>/, '');

    // Wrap non-block content in a starting paragraph tag
    if (!htmlText.startsWith('<h1>') && !htmlText.startsWith('<h2>') && !htmlText.startsWith('<pre>') && !htmlText.startsWith('<ul>') && htmlText.length > 0) {
        htmlText = `<p>${htmlText}`;
    }

    // Ensure we close any opened paragraph tag
    if (htmlText.includes('<p>') && !htmlText.endsWith('</p>') && !htmlText.endsWith('</ul>') && !htmlText.endsWith('</pre>')) {
        htmlText += '</p>';
    }

    // Final cleanup of extra tags
    htmlText = htmlText.replace(/<p><\/p>/g, '');
    htmlText = htmlText.replace(/<p><br>/g, '<p>');
    htmlText = htmlText.replace(/<br><\/p>/g, '</p>');
    
    // Set the final HTML
    outputPanel.innerHTML = htmlText.trim();
};

/**
 * Clears and displays an error message.
 * @param {string} message - The error message.
 */
const showError = (message) => {
    errorText.textContent = message;
    errorMessage.classList.remove('hidden');
};

/**
 * Clears the error message.
 */
const clearError = () => {
    errorMessage.classList.add('hidden');
    errorText.textContent = '';
};

/**
 * Calls the Gemini API with exponential backoff for resilience.
 * @param {object} payload - The request payload.
 * @param {number} attempt - Current retry attempt (starts at 1).
 * @returns {Promise<object>} The API response JSON.
 */
async function callGeminiAPI(payload, attempt = 1) {
    if (!apiKey) {
        throw new Error("Gemini API key is not configured.");
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            if (response.status === 429 && attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.log(`Rate limit exceeded (429). Retrying in ${delay.toFixed(0)}ms (Attempt ${attempt + 1}/${MAX_RETRIES}).`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return callGeminiAPI(payload, attempt + 1); // Retry with next attempt number
            }
            const errorJson = await response.json();
            throw new Error(`API Error: ${response.status} - ${errorJson.error?.message || response.statusText}`);
        }

        return response.json();

    } catch (error) {
        throw new Error(`Fetch failed: ${error.message}`);
    }
}

/**
 * Main function to handle user request and call the API.
 */
async function processCode() {
    clearError();
    const code = codeInput.value.trim();
    const language = languageSelector.value;
    const mode = modeSelector.value;

    if (code.length < 10) {
        showError("Please paste a valid code snippet (at least 10 characters long).");
        return;
    }

    // UI State: Loading
    processButton.disabled = true;
    loadingSpinner.classList.remove('hidden');
    buttonText.textContent = mode === 'explain' ? 'Explaining...' : mode === 'debug' ? 'Debugging...' : 'Refactoring...';
    outputPanel.innerHTML = '<p class="text-indigo-600 italic animate-pulse">Analyzing code, please wait...</p>';

    try {
        const systemInstruction = getSystemInstruction(mode, language);
        const userQuery = getUserQuery(mode, code);

        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
        };

        const result = await callGeminiAPI(payload);

        const generatedText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!generatedText) {
            throw new Error("Gemini did not return a valid response. Check API usage or prompt.");
        }

        renderMarkdown(generatedText);

    } catch (error) {
        console.error("Gemini Code Assistant Error:", error);
        showError(error.message);
        outputPanel.innerHTML = `<p class="text-red-500 font-semibold">Failed to get analysis. Please check the console for details.</p>`;
    } finally {
        // UI State: Ready
        processButton.disabled = false;
        loadingSpinner.classList.add('hidden');
        buttonText.textContent = 'Analyze Code with Gemini';
    }
}

// --- Event Listener ---
processButton.addEventListener('click', processCode);

// Populate example code on load
window.onload = () => {
    codeInput.value = `
function calculateTotal(items) {
    let total = 0;
    for (let i = 0; i <= items.length; i++) {
        total += items[i].price;
    }
    return total;
}
// Example call: calculateTotal([{price: 10}, {price: 20}])
    `.trim();
};