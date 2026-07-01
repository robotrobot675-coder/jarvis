import os
import subprocess
import json
import sys
import webbrowser
import threading
import re
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder=None)
DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Configuration ──────────────────────────────────────────
CONFIG_FILE = os.path.join(DIR, 'config.json')
CONFIG = {
    'ai_provider': 'groq',
    'api_key': '',
    'model': 'llama3-8b-8192',
}

def load_config():
    global CONFIG
    try:
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE) as f:
                CONFIG.update(json.load(f))
    except: pass

def save_config():
    try:
        with open(CONFIG_FILE, 'w') as f:
            json.dump(CONFIG, f, indent=2)
    except: pass

load_config()

# ─── System Commands ─────────────────────────────────────────
SYSTEM_COMMANDS = {
    'notepad': ('notepad.exe', None),
    'calculator': ('calc.exe', None),
    'cmd': ('cmd.exe', None),
    'command prompt': ('cmd.exe', None),
    'terminal': ('cmd.exe', None),
    'powershell': ('powershell.exe', None),
    'explorer': ('explorer.exe', None),
    'file explorer': ('explorer.exe', None),
    'chrome': ('start chrome', True),
    'google chrome': ('start chrome', True),
    'edge': ('start msedge', True),
    'browser': ('start chrome', True),
    'firefox': ('start firefox', True),
    'vscode': ('code', True),
    'vs code': ('code', True),
    'visual studio code': ('code', True),
    'settings': ('start ms-settings:', True),
    'task manager': ('taskmgr.exe', None),
    'paint': ('mspaint.exe', None),
    'word': ('start winword', True),
    'microsoft word': ('start winword', True),
    'excel': ('start excel', True),
    'microsoft excel': ('start excel', True),
    'notepad++': ('notepad++.exe', True),
    'spotify': ('start spotify:', True),
    'youtube': ('start https://youtube.com', True),
    'github': ('start https://github.com', True),
    'google': ('start https://google.com', True),
    'gmail': ('start https://mail.google.com', True),
    'instagram': ('start https://instagram.com', True),
    'whatsapp': ('start https://web.whatsapp.com', True),
    'outlook': ('start outlook.exe', True),
    'camera': ('start microsoft.windows.camera:', True),
    'control panel': ('control', None),
    'calculator': ('calc.exe', None),
    'calendar': ('start outlookcal:', True),
    'maps': ('start bingmaps:', True),
    'store': ('start ms-windows-store:', True),
    'snipping tool': ('SnippingTool.exe', None),
}

def open_application(app_name):
    app_name = app_name.lower().strip()
    for key, (cmd, shell) in SYSTEM_COMMANDS.items():
        if key in app_name or app_name in key:
            try:
                if shell:
                    subprocess.Popen(cmd, shell=True)
                else:
                    subprocess.Popen(cmd)
                return f"Opened {key}"
            except Exception as e:
                return f"Failed to open {key}: {e}"
    try:
        subprocess.Popen(f'start {app_name}', shell=True)
        return f"Trying to open {app_name}"
    except:
        return f"Could not find application: {app_name}"

def execute_shell_command(command):
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=10)
        output = result.stdout or result.stderr or 'Done.'
        return output[:500]
    except subprocess.TimeoutExpired:
        return 'Command timed out.'
    except Exception as e:
        return f'Error: {e}'

def write_file(path, content):
    try:
        full_path = os.path.join(DIR, path) if not os.path.isabs(path) else path
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, 'w') as f:
            f.write(content)
        return f"Written to {path}"
    except Exception as e:
        return f"Write error: {e}"

def read_file(path):
    try:
        full_path = os.path.join(DIR, path) if not os.path.isabs(path) else path
        with open(full_path) as f:
            return f.read()[:1000]
    except Exception as e:
        return f"Read error: {e}"

def list_files(path='.'):
    try:
        target = os.path.join(DIR, path) if not os.path.isabs(path) else path
        items = os.listdir(target)
        return '\n'.join(items[:50])
    except Exception as e:
        return f"List error: {e}"

# ─── Conversation Context ────────────────────────────────────
CONV_HISTORY = []

def add_to_history(role, content):
    CONV_HISTORY.append({'role': role, 'content': content})
    if len(CONV_HISTORY) > 20:
        CONV_HISTORY.pop(0)

# ─── Intent Parsing ──────────────────────────────────────────
def parse_intent(text):
    lower = text.lower().strip()

    if re.search(r'^(open|launch|start)\s+', lower):
        app = re.sub(r'^(open|launch|start)\s+', '', lower)
        app = re.sub(r'\s+(and|aur|karo|kar do|kar de)\s*.*$', '', app).strip()
        return ('open', app)

    if re.search(r'(kholo|khol|khole|kholi)\s*$', lower):
        app = re.sub(r'\s+(kholo|khol|khole|kholi)\s*$', '', lower)
        app = re.sub(r'\s+(and|aur|karo|kar do|kar de)\s*.*$', '', app).strip()
        return ('open', app.strip())

    if re.search(r'^(create|make|write|save)\s+(file|script|code)', lower):
        # Extract filename and content from the text
        match = re.search(r'(?:called|named|as)\s+["\']?(\S+?)["\']?', lower)
        filename = match.group(1) if match else 'untitled.txt'
        content_match = re.search(r'with content["\']?["\']?(.+?)$', lower)
        content = content_match.group(1) if content_match else '# New file'
        return ('write', filename, content)

    if re.search(r'^(read|show|open|get)\s+(file\s+)?', lower):
        path = re.sub(r'^(read|show|open|get)\s+(file\s+)?', '', lower)
        return ('read', path.strip())

    if re.search(r'^(list|show|dir)\s+(files|directory|folder)', lower):
        path_match = re.search(r'in\s+(\S+)', lower)
        path = path_match.group(1) if path_match else '.'
        return ('list', path)

    if re.search(r'^(run|execute|do)\s+', lower):
        cmd = re.sub(r'^(run|execute|do)\s+', '', lower)
        return ('shell', cmd)

    if re.search(r'^(search|find|look up|google)\s+', lower):
        query = re.sub(r'^(search|find|look up|google)\s+', '', lower)
        query = re.sub(r'^for\s+', '', query)
        return ('search', query)

    if re.search(r'^(play|chala|baja|chalao|bajao)\s+', lower):
        query = re.sub(r'^(play|chala|baja|chalao|bajao)\s+', '', lower)
        query = re.sub(r'\s+(on youtube|youtube pe|on yt|on music|song|video)\s*$', '', query)
        return ('play', query.strip())

    if re.search(r'\s+(chalao|bajao|chala|baja)\s*$', lower):
        query = re.sub(r'\s+(chalao|bajao|chala|baja)\s*$', '', lower)
        return ('play', query.strip())

    if re.search(r'\b(time|date|weather|joke)\b', lower):
        return ('info', lower)

    return ('chat', text)

# ─── AI Query ─────────────────────────────────────────────────
def query_ai(prompt):
    provider = CONFIG.get('ai_provider', 'groq')
    api_key = CONFIG.get('api_key', '')
    model = CONFIG.get('model', 'llama3-8b-8192')

    add_to_history('user', prompt)

    if provider == 'groq' and api_key:
        return query_groq(prompt, api_key, model)
    elif provider == 'openai' and api_key:
        return query_openai(prompt, api_key, model)
    elif provider == 'gemini' and api_key:
        return query_gemini(prompt, api_key, model)
    else:
        return None

SMART_PROMPT = """You are JARVIS — a super-intelligent AI assistant for Windows PC. You control apps, files, commands, and web. You think step-by-step and handle complex multi-step commands.

Current date: """ + __import__('datetime').datetime.now().strftime('%Y-%m-%d') + """

## RULES
- Respond in English only, concise and natural. Be smart, witty, helpful.
- Break down complex commands into steps. Think before responding.
- Do NOT create unnecessary files or shortcuts. Only do what is asked.
- You can answer ANY question: coding, science, math, history, tech, general knowledge.

## POWERS (use action tags to execute)

[WRITE_FILE:filename]
code or text content
→ Creates a file. Filename only, no path.

[RUN:command]
→ Execute anything on the PC. Examples:
  [RUN:start https://youtube.com] — Open YouTube homepage
  [RUN:start https://youtube.com/results?search_query=cats] — Search YouTube (use for "search" commands)
  [RUN:start https://music.youtube.com/search?q=despacito] — Play music on YouTube Music (use for "play" commands)
  [RUN:start notepad.exe] — Open app
  [RUN:calc.exe] — Calculator
  [RUN:notepad C:\path\to\file.txt] — Open file in Notepad
  [RUN:start ms-settings:] — Windows Settings
  [RUN:code C:\path\to\file] — VS Code
  [RUN:taskmgr.exe] — Task Manager
  [RUN:start msedge] — Edge browser
  [RUN:start https://instagram.com] — Instagram
  [RUN:start https://web.whatsapp.com] — WhatsApp Web
  [RUN:start https://google.com/search?q=KEYWORD] — Google search
  [RUN:start https://github.com] — GitHub
  [RUN:start https://mail.google.com] — Gmail
  [RUN:start spotify:] — Spotify
  [RUN:start ms-windows-store:] — Store
  [RUN:explorer.exe] — File Explorer
  [RUN:mspaint.exe] — Paint
  [RUN:cmd.exe /c dir /b] — List files
  [RUN:powershell -Command "Get-Process | Select Name"] — List processes

[SEARCH:query]
→ Opens Google search for query (only for general web searches)

## SMART MULTI-STEP EXAMPLES

User: "play despacito on youtube"
You: [RUN:start https://music.youtube.com/search?q=despacito]
Playing Despacito on YouTube Music.

User: "youtube pe punjabi song chalao"
You: [RUN:start https://music.youtube.com/search?q=punjabi+song]
Playing Punjabi songs on YouTube Music.

User: "play relaxing music"
You: [RUN:start https://music.youtube.com/search?q=relaxing+music]
Playing relaxing music on YouTube Music.

User: "notepad kholo aur hello world likho"
You: [WRITE_FILE:note.txt]
Hello World
[RUN:notepad note.txt]
Done! Created note.txt and opened in Notepad.

User: "youtube kholo aur gana search karo"
You: [RUN:start https://youtube.com/results?search_query=gana]
Opened YouTube searching for songs.

User: "open chrome and search for today's news"
You: [RUN:start https://google.com/search?q=today+news]
Opened Chrome with today's news.

User: "instagram kholo aur memes search karo"
You: [RUN:start https://instagram.com]
[RUN:start https://google.com/search?q=instagram+memes]
Opened Instagram. Searched for memes.

User: "create a python file that prints fibonacci series"
You: [WRITE_FILE:fib.py]
def fib(n):
    a,b=0,1
    for i in range(n): print(a,end=' '); a,b=b,a+b
fib(10)
Created fib.py — prints first 10 Fibonacci numbers.

User: "what files are in my project folder"
You: [RUN:cmd.exe /c dir /b C:/Users/gupta/jarvis]
Listing files...

User: "open notepad"
You: [RUN:start notepad.exe]
Opened Notepad.

User: "chrome kholo"
You: [RUN:start chrome]
Opened Chrome.

User: "calculator kholo"
You: [RUN:calc.exe]
Opened Calculator.

## IMPORTANT
For Hinglish commands like "X kholo" → use [RUN:start X] or appropriate command.
For multi-step commands with "aur/and" → use multiple action tags.
Think step by step for complex commands.
Always be helpful and use action tags to actually DO things, not just describe them."""

def query_groq(prompt, api_key, model='llama-3.1-8b-instant'):
    try:
        import requests
        messages = [{'role': 'system', 'content': SMART_PROMPT}]
        messages.extend(CONV_HISTORY)
        r = requests.post(
            'https://api.groq.com/openai/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={'model': model, 'messages': messages, 'max_tokens': 2000, 'temperature': 0.7},
            timeout=30
        )
        reply = r.json()['choices'][0]['message']['content']
        add_to_history('assistant', reply)
        return reply
    except Exception as e:
        return f'AI error: {e}'

def query_openai(prompt, api_key, model='gpt-4o-mini'):
    try:
        import requests
        messages = [{'role': 'system', 'content': SMART_PROMPT}]
        messages.extend(CONV_HISTORY)
        r = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'},
            json={'model': model, 'messages': messages, 'max_tokens': 2000},
            timeout=30
        )
        reply = r.json()['choices'][0]['message']['content']
        add_to_history('assistant', reply)
        return reply
    except Exception as e:
        return f'AI error: {e}'

def query_gemini(prompt, api_key, model='gemini-2.0-flash'):
    try:
        import requests
        from datetime import datetime
        context = f'You are Jarvis, a smart AI assistant on Windows. Date: {datetime.now().strftime("%Y-%m-%d")}. Always respond in English. You can control the PC. Respond concisely.'
        r = requests.post(
            f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}',
            json={'contents': [{'role': 'user', 'parts': [{'text': f'{context}\n\nUser: {prompt}'}]}]},
            timeout=30
        )
        reply = r.json()['candidates'][0]['content']['parts'][0]['text']
        add_to_history('assistant', reply)
        return reply
    except Exception as e:
        return f'AI error: {e}'

# ─── AI Action Execution ─────────────────────────────────────
def execute_ai_actions(response):
    lines = response.split('\n')
    output = []
    i = 0
    while i < len(lines):
        line = lines[i]

        write_match = re.match(r'\[WRITE_FILE:([^\]]+)\]', line)
        if write_match:
            path = write_match.group(1).strip()
            code_lines = []
            i += 1
            while i < len(lines):
                code_line = lines[i]
                if code_line.startswith('```'):
                    i += 1
                    break
                if re.match(r'\[(RUN|SEARCH|WRITE_FILE):', code_line):
                    break
                code_lines.append(code_line)
                i += 1
            content = '\n'.join(code_lines)
            if content.strip():
                result = write_file(path, content)
                output.append(f'[Created {path}]')
            else:
                output.append(line)
            continue

        run_match = re.match(r'\[RUN:([^\]]+)\]', line)
        if run_match:
            cmd = run_match.group(1).strip()
            execute_shell_command(cmd)
            output.append(f'[Executed: {cmd}]')
            i += 1
            continue

        search_match = re.match(r'\[SEARCH:([^\]]+)\]', line)
        if search_match:
            q = search_match.group(1).strip()
            webbrowser.open(f'https://www.google.com/search?q={__import__("urllib").parse.quote(q)}')
            output.append(f'[Searching: {q}]')
            i += 1
            continue

        if line.startswith('```'):
            i += 1
            continue

        output.append(line)
        i += 1

    return '\n'.join(output).strip()

# ─── Process Query ───────────────────────────────────────────
def process_query(text):
    lower = text.lower().strip()

    # Multi-intent: if contains "and/aur/then/phir", let AI handle it
    if re.search(r'\b(and|aur|then|phir)\b', lower):
        ai_response = query_ai(text)
        if ai_response:
            return execute_ai_actions(ai_response)
        return f'Could not process complex command: "{text}"'

    intent = parse_intent(text)
    action = intent[0]

    # Handle info commands locally
    if action == 'info':
        from datetime import datetime
        lower = text.lower()
        if 'time' in lower:
            return f"The time is {datetime.now().strftime('%I:%M %p')}"
        if 'date' in lower:
            return f"Today is {datetime.now().strftime('%A, %B %d, %Y')}"
        if 'weather' in lower:
            try:
                import requests
                r = requests.get('https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.23&current_weather=true', timeout=5)
                w = r.json()['current_weather']
                codes = {0:'clear',1:'clear',2:'cloudy',3:'overcast',45:'foggy',51:'drizzle',61:'rain',71:'snow',80:'rain',95:'thunderstorm'}
                desc = codes.get(w['weathercode'], f'code {w["weathercode"]}')
                return f"Weather: {desc}, {w['temperature']}°C, wind {w['windspeed']} km/h"
            except:
                return "Could not fetch weather."
        if 'joke' in lower:
            try:
                import requests
                r = requests.get('https://v2.jokeapi.dev/joke/Any?type=single', timeout=5)
                return r.json().get('joke', 'No joke found.')
            except:
                return "Why do programmers prefer dark mode? Light attracts bugs!"
        return f"I can help with time, date, weather, and jokes. Try: 'what time is it?'"

    # Handle system commands
    if action == 'open':
        result = open_application(intent[1])
        return result

    if action == 'write':
        return write_file(intent[1], intent[2])

    if action == 'read':
        return read_file(intent[1])

    if action == 'list':
        return list_files(intent[1])

    if action == 'shell':
        return execute_shell_command(intent[1])

    if action == 'search':
        query = intent[1]
        webbrowser.open(f'https://www.google.com/search?q={__import__("urllib").parse.quote(query)}')
        return f'Searching Google for: {query}'

    if action == 'play':
        return play_youtube(intent[1])

    if action == 'chat':
        ai_response = query_ai(text)
        if ai_response:
            clean_response = execute_ai_actions(ai_response)
            return clean_response
        return f'I heard: "{text}". Configure AI in settings for smart responses.'

def play_youtube(query):
    try:
        import yt_dlp
        ydl = yt_dlp.YoutubeDL({'quiet': True, 'extract_flat': True, 'noplaylist': True})
        info = ydl.extract_info(f'ytsearch:{query}', download=False)
        if info and info.get('entries'):
            video_url = info['entries'][0]['url']
            webbrowser.open(video_url)
            return f'Playing {query} on YouTube'
        return f'No results for {query}'
    except Exception as e:
        return f'Could not play {query}: {e}'

# ─── Routes ──────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory(DIR, 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory(DIR, path)

@app.route('/api/query', methods=['POST'])
def api_query():
    data = request.json or {}
    text = data.get('text', '').strip()
    if not text:
        return jsonify({'response': 'Please say something.'})
    response = process_query(text)
    return jsonify({'response': response})

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    if request.method == 'POST':
        data = request.json or {}
        CONFIG.update({k: v for k, v in data.items() if k in ('ai_provider', 'api_key', 'model')})
        save_config()
        return jsonify({'status': 'saved', 'config': {k: v for k, v in CONFIG.items() if k != 'api_key' or v}})
    return jsonify({k: v for k, v in CONFIG.items() if k != 'api_key'})

@app.route('/api/test/write', methods=['POST'])
def api_test_write():
    data = request.json or {}
    path = data.get('path', 'test.txt')
    content = data.get('content', 'hello')
    result = write_file(path, content)
    return jsonify({'result': result, 'path': path, 'exists': os.path.exists(os.path.join(DIR, path))})

@app.route('/api/status')
def api_status():
    has_key = bool(CONFIG.get('api_key'))
    return jsonify({
        'ai': has_key,
        'provider': CONFIG.get('ai_provider', 'none'),
        'has_key': has_key,
        'system_access': True,
    })

# ─── Main ────────────────────────────────────────────────────
if __name__ == '__main__':
    PORT = 8765
    url = f'http://localhost:{PORT}'
    print(f'\n  Jarvis backend running at {url}')
    print(f'  Press Ctrl+C to stop\n')
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    app.run(host='0.0.0.0', port=PORT, debug=False, use_reloader=False)
