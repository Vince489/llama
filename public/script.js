document.addEventListener('DOMContentLoaded', () => {
    const chatLog = document.getElementById('chat-log');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');

    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendMessage();
        }
    });

    async function sendMessage() {
        const message = userInput.value.trim();
        if (message) {
            appendMessage('user', message);
            userInput.value = '';

            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message: message }),
            });

            if (response.ok) {
                const data = await response.json();
                appendMessage('bot', data.response);
                // After a potential email search, check if authentication is needed
                if (message.includes('email') || message.includes('mail') && data.response.includes('authenticate')) {
                    displayAuthLink();
                }
            } else {
                appendMessage('bot', 'Sorry, there was an error communicating with the server.');
            }
        }
    }

    function appendMessage(sender, text) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add(`${sender}-message`);
        
        // Check if the response contains HTML
        if (sender === 'bot' && (text.includes('<div class="email-') || text.includes('<div class="search-'))) {
            messageDiv.innerHTML = text;
        } else {
            messageDiv.textContent = text;
        }
        
        chatLog.appendChild(messageDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    function displayAuthLink() {
        const authLink = document.createElement('a');
        authLink.href = '/auth';
        authLink.textContent = 'Click here to authenticate with Gmail.';
        chatLog.appendChild(document.createElement('br'));
        chatLog.appendChild(authLink);
    }
});
