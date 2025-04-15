const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs').promises;
const app = express();
const port = 3000;
require('dotenv').config();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify'
];

const TOKEN_PATH = path.join(__dirname, 'config', 'token.json');

const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

async function loadToken() {
    try {
        const content = await fs.readFile(TOKEN_PATH, 'utf-8');
        const tokens = JSON.parse(content);
        
        // Optional: Verify scopes match what we expect
        const tokenScopes = tokens.scope.split(' ');
        const hasAllScopes = SCOPES.every(scope => tokenScopes.includes(scope));
        
        if (!hasAllScopes) {
            console.warn('Warning: Token scopes do not match application scopes. Consider re-authenticating.');
        }
        
        oAuth2Client.setCredentials(tokens);
        return true;
    } catch (error) {
        return false;
    }
}

async function saveToken(tokens) {
    try {
        await fs.mkdir(path.dirname(TOKEN_PATH), { recursive: true });
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        console.log('Token stored to', TOKEN_PATH);
    } catch (error) {
        console.error('Error saving token:', error);
    }
}

app.get('/auth', (req, res) => {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    try {
        const tokenResponse = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokenResponse.tokens);
        await saveToken(tokenResponse.tokens);
        res.send('Authentication successful! You can now use the chatbot with email access.');
    } catch (error) {
        console.error('Error retrieving access token:', error);
        res.status(500).send('Error during authentication.');
    }
});

async function searchGmail(query) {
    try {
        const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread ' + query,
            maxResults: 5,
        });

        if (!response.data.messages) {
            return { results: [], message: `No emails found matching: ${query}` };
        }

        const emailDetails = [];
        for (const message of response.data.messages) {
            const email = await gmail.users.messages.get({
                userId: 'me',
                id: message.id,
                format: 'metadata',
            });
            emailDetails.push({
                id: message.id,
                from: email.data.payload.headers.find(h => h.name === 'From')?.value,
                subject: email.data.payload.headers.find(h => h.name === 'Subject')?.value,
                snippet: email.data.snippet,
                date: email.data.payload.headers.find(h => h.name === 'Date')?.value
            });
        }
        return { results: emailDetails };
    } catch (error) {
        console.error('Error searching Gmail:', error);
        return { error: `Error searching Gmail: ${error.message}` };
    }
}

async function searchWeb(query) {
  try {
    const customsearch = google.customsearch('v1');
    const result = await customsearch.cse.list({
      auth: process.env.GOOGLE_SEARCH_API_KEY,
      cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
      q: query,
      num: 5 // Number of results to return
    });
    
    return result.data.items || [];
  } catch (error) {
    console.error('Error searching the web:', error);
    return [];
  }
}

app.post('/chat', async (req, res) => {
    const userMessage = req.body.message.toLowerCase().trim();

    // Handle email requests
    if (userMessage.includes('unread email') || userMessage.includes('unread mail')) {
        if (!oAuth2Client.credentials) {
            res.json({ response: 'Please <a href="/auth">authenticate with Gmail</a> first to access emails.' });
            return;
        }

        const gmailResults = await searchGmail('');

        if (gmailResults.error) {
            res.json({ response: `Sorry, I encountered an error: ${gmailResults.error}` });
        } else if (gmailResults.results && gmailResults.results.length > 0) {
            let response = `<div class="email-count">You have ${gmailResults.results.length} unread email${gmailResults.results.length === 1 ? '' : 's'}</div>`;
            
            response += '<div class="email-list">';
            gmailResults.results.forEach(email => {
                const fromName = email.from.match(/([^<]+)/) ? email.from.match(/([^<]+)/)[0].trim() : email.from;
                response += `
                <div class="email-card">
                    <div class="email-sender">${fromName}</div>
                    <div class="email-subject">${email.subject}</div>
                    <div class="email-snippet">${email.snippet}</div>
                </div>`;
            });
            response += '</div>';
            
            res.json({ response: response, isHTML: true });
        } else {
            res.json({ response: 'You have no unread emails.' });
        }
        return;
    }
    
    // Handle web search requests
    if (userMessage.includes('search for') || userMessage.startsWith('find') || userMessage.includes('look up')) {
        // Extract the search query
        let searchQuery = userMessage;
        if (userMessage.includes('search for')) {
            searchQuery = userMessage.split('search for')[1].trim();
        } else if (userMessage.startsWith('find')) {
            searchQuery = userMessage.substring(4).trim();
        } else if (userMessage.includes('look up')) {
            searchQuery = userMessage.split('look up')[1].trim();
        }
        
        // Perform the search
        const searchResults = await searchWeb(searchQuery);
        
        if (searchResults.length === 0) {
            res.json({ response: `I couldn't find any results for "${searchQuery}".` });
            return;
        }
        
        // Format the results as HTML
        let response = `<div class="search-results">
            <div class="search-query">Search results for: <strong>${searchQuery}</strong></div>
            <div class="results-list">`;
            
        searchResults.forEach(result => {
            response += `
                <div class="search-result">
                    <a href="${result.link}" target="_blank" class="result-title">${result.title}</a>
                    <div class="result-link">${result.displayLink}</div>
                    <div class="result-snippet">${result.snippet}</div>
                </div>`;
        });
        
        response += `</div></div>`;
        
        res.json({ response: response, isHTML: true });
        return;
    }

    // Handle other chatbot logic here
    res.json({ response: 'I can show unread emails or search the web. Try saying "search for climate change" or "show unread emails".' });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, async () => {
    console.log(`Server listening at http://localhost:${port}`);
    await loadToken();
    if (oAuth2Client.credentials) {
        console.log('Gmail token loaded.');
    } else {
        console.log('Gmail token not found. Please visit /auth to authenticate.');
    }
});
