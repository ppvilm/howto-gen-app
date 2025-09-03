#!/bin/bash

# Test howto-prompt with the example application
echo "🧪 Testing howto-prompt with example application..."

# Set OpenAI API key (you need to set this)
# export OPENAI_API_KEY="your-openai-api-key"

# Check if API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ Please set OPENAI_API_KEY environment variable"
    echo "   export OPENAI_API_KEY='your-api-key'"
    exit 1
fi

# Base URL and credentials from example-guide-reg.md
BASE_URL="https://smoketest.live-a.botium.cyaraportal.eu"
EMAIL="admin"
PASSWORD="C6jN5yF4Vq7x6AXb"

echo "🎯 Target URL: $BASE_URL"
echo "📧 Email: $EMAIL"
echo "🔐 Password: [HIDDEN]"
echo ""

# Test prompt that matches the example guide
PROMPT="Gehe zur Login-Seite und logge dich ein. Dann öffne die Regression-Übersicht und erstelle einen neuen Test."

echo "💬 Prompt: $PROMPT"
echo ""

# Navigate to project directory and run
cd "$(dirname "$0")/howto-cli"

# Run the prompt command
npm run start -- prompt "$PROMPT" \
    --base-url "$BASE_URL" \
    --headful \
    --out ../output \
    --max-steps 15 \
    --max-refines 2 \
    --model gpt-4

echo ""
echo "✅ Test completed! Check ../output directory for results."