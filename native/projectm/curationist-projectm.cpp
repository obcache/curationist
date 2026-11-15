#define WIN32_LEAN_AND_MEAN
#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <windows.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <wincrypt.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <GL/gl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <atomic>
#include <chrono>

#include <projectM-4/projectM.h>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "advapi32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")
#pragma comment(lib, "gdi32.lib")
#pragma comment(lib, "opengl32.lib")
#pragma comment(lib, "projectM-4.lib")

// OpenGL function pointers for FBO & Core Profile
typedef HGLRC (WINAPI * PFNWGLCREATECONTEXTATTRIBSARBPROC) (HDC hDC, HGLRC hShareContext, const int *attribList);
#define WGL_CONTEXT_MAJOR_VERSION_ARB 0x2091
#define WGL_CONTEXT_MINOR_VERSION_ARB 0x2092
#define WGL_CONTEXT_PROFILE_MASK_ARB 0x9126
#define WGL_CONTEXT_CORE_PROFILE_BIT_ARB 0x00000001

typedef void (APIENTRY * PFNGLGENFRAMEBUFFERSPROC) (GLsizei n, GLuint *framebuffers);
typedef void (APIENTRY * PFNGLBINDFRAMEBUFFERPROC) (GLenum target, GLuint framebuffer);
typedef void (APIENTRY * PFNGLFRAMEBUFFERTEXTURE2DPROC) (GLenum target, GLenum attachment, GLenum textarget, GLuint texture, GLint level);
typedef void (APIENTRY * PFNGLDELETEFRAMEBUFFERSPROC) (GLsizei n, const GLuint *framebuffers);
#define GL_FRAMEBUFFER 0x8D40
#define GL_COLOR_ATTACHMENT0 0x8CE0

static PFNGLGENFRAMEBUFFERSPROC glGenFramebuffersPtr = NULL;
static PFNGLBINDFRAMEBUFFERPROC glBindFramebufferPtr = NULL;
static PFNGLFRAMEBUFFERTEXTURE2DPROC glFramebufferTexture2DPtr = NULL;
static PFNGLDELETEFRAMEBUFFERSPROC glDeleteFramebuffersPtr = NULL;

static void* resolve_gl(const char* name, void* user_data) {
    void* p = (void*)wglGetProcAddress(name);
    if (!p || p == (void*)0x1 || p == (void*)0x2 || p == (void*)0x3 || p == (void*)-1) {
        static HMODULE hGl = LoadLibraryA("opengl32.dll");
        p = (void*)GetProcAddress(hGl, name);
    }
    return p;
}

// Global runtime state
static std::atomic<bool> g_running(true);
static std::atomic<bool> g_isPlaying(true);
static std::atomic<bool> g_isLocked(true);
static std::atomic<bool> g_lockChanged(false);
static std::atomic<bool> g_smoothTransition(false);
static std::atomic<int> g_renderWidth(400);
static std::atomic<int> g_renderHeight(300);
static std::atomic<int> g_targetFps(30);
static std::atomic<bool> g_sizeChanged(false);

static std::mutex g_presetMutex;
static std::string g_pendingPresetPath = "";
static std::string g_currentPresetName = "(None)";
static bool g_newPresetPending = false;

static std::mutex g_clientMutex;
static std::vector<SOCKET> g_clients;

// WebSocket Handshake helper
static std::string compute_ws_accept(const std::string& client_key) {
    std::string combined = client_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    BYTE hash[20];
    DWORD hashLen = 20;
    CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT);
    CryptCreateHash(hProv, CALG_SHA1, 0, 0, &hHash);
    CryptHashData(hHash, (const BYTE*)combined.data(), (DWORD)combined.size(), 0);
    CryptGetHashParam(hHash, HP_HASHVAL, hash, &hashLen, 0);
    CryptDestroyHash(hHash);
    CryptReleaseContext(hProv, 0);

    char base64[64] = {0};
    DWORD base64Len = sizeof(base64);
    CryptBinaryToStringA(hash, hashLen, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, base64, &base64Len);
    return std::string(base64);
}

static void send_ws_binary(SOCKET sock, const uint8_t* data, size_t len) {
    std::vector<uint8_t> frame;
    frame.push_back(0x82); // FIN + binary opcode

    if (len < 126) {
        frame.push_back((uint8_t)len);
    } else if (len < 65536) {
        frame.push_back(126);
        frame.push_back((uint8_t)((len >> 8) & 0xFF));
        frame.push_back((uint8_t)(len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; i--) {
            frame.push_back((uint8_t)((len >> (i * 8)) & 0xFF));
        }
    }

    size_t headerSize = frame.size();
    frame.resize(headerSize + len);
    memcpy(frame.data() + headerSize, data, len);

    send(sock, (const char*)frame.data(), (int)frame.size(), 0);
}

static void send_ws_text(SOCKET sock, const std::string& text) {
    std::vector<uint8_t> frame;
    frame.push_back(0x81); // FIN + text opcode
    size_t len = text.size();

    if (len < 126) {
        frame.push_back((uint8_t)len);
    } else if (len < 65536) {
        frame.push_back(126);
        frame.push_back((uint8_t)((len >> 8) & 0xFF));
        frame.push_back((uint8_t)(len & 0xFF));
    } else {
        frame.push_back(127);
        for (int i = 7; i >= 0; i--) {
            frame.push_back((uint8_t)((len >> (i * 8)) & 0xFF));
        }
    }

    size_t headerSize = frame.size();
    frame.resize(headerSize + len);
    memcpy(frame.data() + headerSize, text.data(), len);

    send(sock, (const char*)frame.data(), (int)frame.size(), 0);
}

static void broadcast_ws_binary(const uint8_t* data, size_t len) {
    std::lock_guard<std::mutex> lock(g_clientMutex);
    std::vector<SOCKET> alive;
    for (SOCKET s : g_clients) {
        int res = send(s, "", 0, 0);
        if (res >= 0) {
            send_ws_binary(s, data, len);
            alive.push_back(s);
        } else {
            closesocket(s);
        }
    }
    g_clients = alive;
}

static void broadcast_ws_text(const std::string& text) {
    std::lock_guard<std::mutex> lock(g_clientMutex);
    std::vector<SOCKET> alive;
    for (SOCKET s : g_clients) {
        int res = send(s, "", 0, 0);
        if (res >= 0) {
            send_ws_text(s, text);
            alive.push_back(s);
        } else {
            closesocket(s);
        }
    }
    g_clients = alive;
}

// Client message parser
static void handle_client_message(const std::string& msg) {
    // Basic JSON string value extractor
    auto extract_str = [](const std::string& src, const std::string& key) -> std::string {
        size_t pos = src.find("\"" + key + "\"");
        if (pos == std::string::npos) return "";
        pos = src.find(":", pos);
        if (pos == std::string::npos) return "";
        size_t start = src.find("\"", pos);
        if (start == std::string::npos) return "";
        size_t end = src.find("\"", start + 1);
        if (end == std::string::npos) return "";
        std::string val = src.substr(start + 1, end - start - 1);
        // replace escaped backslashes
        std::string unescaped;
        for (size_t i = 0; i < val.length(); i++) {
            if (val[i] == '\\' && i + 1 < val.length()) {
                if (val[i + 1] == '\\') { unescaped += '\\'; i++; continue; }
                if (val[i + 1] == '/')  { unescaped += '/';  i++; continue; }
                if (val[i + 1] == 'n')  { unescaped += '\n'; i++; continue; }
            }
            unescaped += val[i];
        }
        return unescaped;
    };

    auto extract_num = [](const std::string& src, const std::string& key, int defaultVal) -> int {
        size_t pos = src.find("\"" + key + "\"");
        if (pos == std::string::npos) return defaultVal;
        pos = src.find(":", pos);
        if (pos == std::string::npos) return defaultVal;
        while (pos < src.size() && (src[pos] == ':' || src[pos] == ' ' || src[pos] == '\t')) pos++;
        return atoi(src.c_str() + pos);
    };

    std::string type = extract_str(msg, "type");
    if (type == "load") {
        std::string path = extract_str(msg, "path");
        if (!path.empty()) {
            std::lock_guard<std::mutex> lock(g_presetMutex);
            g_pendingPresetPath = path;
            g_newPresetPending = true;
        }
    } else if (type == "play") {
        g_isPlaying = true;
    } else if (type == "pause") {
        g_isPlaying = false;
    } else if (type == "toggle") {
        g_isPlaying = !g_isPlaying;
    } else if (type == "resize") {
        int w = extract_num(msg, "width", 400);
        int h = extract_num(msg, "height", 300);
        if (w >= 160 && w <= 1920 && h >= 120 && h <= 1080) {
            g_renderWidth = w;
            g_renderHeight = h;
            g_sizeChanged = true;
        }
    } else if (type == "fps") {
        int f = extract_num(msg, "fps", 30);
        if (f >= 15 && f <= 60) {
            g_targetFps = f;
        }
    } else if (type == "transition") {
        g_smoothTransition = (msg.find("true") != std::string::npos);
    } else if (type == "lock") {
        g_isLocked = (msg.find("true") != std::string::npos);
        g_lockChanged = true;
    }
}

// Client socket thread
static void client_worker(SOCKET clientSock) {
    char buf[4096];
    int recvd = recv(clientSock, buf, sizeof(buf) - 1, 0);
    if (recvd <= 0) {
        closesocket(clientSock);
        return;
    }
    buf[recvd] = '\0';

    // Parse HTTP WebSocket upgrade
    std::string req(buf);
    size_t keyPos = req.find("Sec-WebSocket-Key: ");
    if (keyPos == std::string::npos) {
        closesocket(clientSock);
        return;
    }
    size_t keyEnd = req.find("\r\n", keyPos);
    std::string key = req.substr(keyPos + 19, keyEnd - (keyPos + 19));
    std::string accept = compute_ws_accept(key);

    std::string response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";
    send(clientSock, response.c_str(), (int)response.size(), 0);

    {
        std::lock_guard<std::mutex> lock(g_clientMutex);
        g_clients.push_back(clientSock);
    }

    // Send initial status message
    {
        std::lock_guard<std::mutex> lock(g_presetMutex);
        char statusJson[512];
        snprintf(statusJson, sizeof(statusJson),
            "{\"type\":\"status\",\"preset\":\"%s\",\"isPlaying\":%s,\"fps\":%d,\"width\":%d,\"height\":%d}",
            g_currentPresetName.c_str(), g_isPlaying ? "true" : "false", g_targetFps.load(), g_renderWidth.load(), g_renderHeight.load());
        send_ws_text(clientSock, statusJson);
    }

    // Read incoming client frames (masked)
    while (g_running) {
        uint8_t hdr[2];
        int r = recv(clientSock, (char*)hdr, 2, 0);
        if (r <= 0) break;

        uint8_t opcode = hdr[0] & 0x0F;
        bool isMasked = (hdr[1] & 0x80) != 0;
        uint64_t payloadLen = hdr[1] & 0x7F;

        if (payloadLen == 126) {
            uint16_t ext;
            recv(clientSock, (char*)&ext, 2, 0);
            payloadLen = ntohs(ext);
        } else if (payloadLen == 127) {
            uint64_t ext;
            recv(clientSock, (char*)&ext, 8, 0);
            // network to host 64
            payloadLen = 0; // limit large commands
        }

        uint8_t mask[4] = {0};
        if (isMasked) {
            recv(clientSock, (char*)mask, 4, 0);
        }

        if (opcode == 0x08) {
            // Close connection
            break;
        }

        std::vector<uint8_t> payload(payloadLen);
        if (payloadLen > 0) {
            size_t got = 0;
            while (got < payloadLen) {
                int n = recv(clientSock, (char*)payload.data() + got, (int)(payloadLen - got), 0);
                if (n <= 0) break;
                got += n;
            }
            if (isMasked) {
                for (size_t i = 0; i < payloadLen; i++) {
                    payload[i] ^= mask[i % 4];
                }
            }
        }

        if (opcode == 0x01) { // Text message
            std::string text((char*)payload.data(), payload.size());
            handle_client_message(text);
        }
    }

    {
        std::lock_guard<std::mutex> lock(g_clientMutex);
        for (auto it = g_clients.begin(); it != g_clients.end(); ) {
            if (*it == clientSock) {
                it = g_clients.erase(it);
            } else {
                ++it;
            }
        }
    }
    closesocket(clientSock);
}

// WebSocket server accept thread
static void server_thread_func(int port) {
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);

    SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    sockaddr_in addr = { 0 };
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");
    addr.sin_port = htons((u_short)port);

    if (bind(listenSock, (sockaddr*)&addr, sizeof(addr)) != 0) {
        printf("[ProjectM Host] Bind failed on port %d\n", port);
        return;
    }

    listen(listenSock, 4);

    // If port was 0, discover assigned port
    int addrLen = sizeof(addr);
    getsockname(listenSock, (sockaddr*)&addr, &addrLen);
    int activePort = ntohs(addr.sin_port);

    printf("CURATIONIST_PROJECTM_READY %d\n", activePort);
    fflush(stdout);

    while (g_running) {
        SOCKET client = accept(listenSock, NULL, NULL);
        if (client == INVALID_SOCKET) {
            if (!g_running) break;
            continue;
        }
        std::thread(client_worker, client).detach();
    }

    closesocket(listenSock);
    WSACleanup();
}

// WASAPI Audio capture loop
static void audio_capture_func(projectm_handle pm) {
    CoInitializeEx(NULL, COINIT_MULTITHREADED);
    IMMDeviceEnumerator *pEnum = NULL;
    IMMDevice *pDevice = NULL;
    IAudioClient *pAudioClient = NULL;
    IAudioCaptureClient *pCaptureClient = NULL;
    WAVEFORMATEX *pwfx = NULL;
    bool wasapiOk = false;

    if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), NULL, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), (void**)&pEnum))) {
        if (SUCCEEDED(pEnum->GetDefaultAudioEndpoint(eRender, eConsole, &pDevice))) {
            if (SUCCEEDED(pDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, NULL, (void**)&pAudioClient))) {
                if (SUCCEEDED(pAudioClient->GetMixFormat(&pwfx))) {
                    if (SUCCEEDED(pAudioClient->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 0, 0, pwfx, 0))) {
                        if (SUCCEEDED(pAudioClient->GetService(__uuidof(IAudioCaptureClient), (void**)&pCaptureClient))) {
                            if (SUCCEEDED(pAudioClient->Start())) {
                                wasapiOk = true;
                            }
                        }
                    }
                }
            }
        }
    }

    float fakePhase = 0.0f;
    float fakeWave[512 * 2];

    while (g_running) {
        bool readAudio = false;
        if (wasapiOk && pCaptureClient) {
            UINT32 packetSize = 0;
            while (SUCCEEDED(pCaptureClient->GetNextPacketSize(&packetSize)) && packetSize > 0) {
                BYTE *pData;
                UINT32 numFrames;
                DWORD flags;
                if (SUCCEEDED(pCaptureClient->GetBuffer(&pData, &numFrames, &flags, NULL, NULL))) {
                    if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT) && numFrames > 0) {
                        projectm_pcm_add_float(pm, (float*)pData, numFrames, PROJECTM_STEREO);
                        readAudio = true;
                    }
                    pCaptureClient->ReleaseBuffer(numFrames);
                }
            }
        }

        // If no music is currently playing on Windows, generate a gentle rhythmic pulse
        // so visualizations don't freeze into complete darkness
        if (!readAudio) {
            for (int i = 0; i < 512; i++) {
                fakePhase += 0.02f;
                float s = (float)sin(fakePhase) * 0.4f + (float)sin(fakePhase * 0.35f) * 0.3f;
                fakeWave[i * 2] = s;
                fakeWave[i * 2 + 1] = s;
            }
            projectm_pcm_add_float(pm, fakeWave, 512, PROJECTM_STEREO);
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(15));
    }

    if (pAudioClient) pAudioClient->Stop();
    if (pCaptureClient) pCaptureClient->Release();
    if (pAudioClient) pAudioClient->Release();
    if (pDevice) pDevice->Release();
    if (pEnum) pEnum->Release();
    CoUninitialize();
}

int main(int argc, char* argv[]) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
    int port = 49818;
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--port") == 0 && i + 1 < argc) {
            port = atoi(argv[++i]);
        }
    }

    // Start WebSocket server in background
    std::thread serverThread(server_thread_func, port);
    serverThread.detach();

    // Setup offscreen Win32 window and OpenGL 3.3 Core context
    WNDCLASSA wc = { 0 };
    wc.lpfnWndProc = DefWindowProcA;
    wc.hInstance = GetModuleHandleA(NULL);
    wc.lpszClassName = "CurationistProjectMHost";
    RegisterClassA(&wc);

    HWND dummyHwnd = CreateWindowExA(0, wc.lpszClassName, "OffscreenHost", WS_OVERLAPPEDWINDOW, 0, 0, 100, 100, NULL, NULL, wc.hInstance, NULL);
    HDC dummyDC = GetDC(dummyHwnd);
    PIXELFORMATDESCRIPTOR pfd = { sizeof(PIXELFORMATDESCRIPTOR), 1,
        PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER,
        PFD_TYPE_RGBA, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 24, 8, 0,
        PFD_MAIN_PLANE, 0, 0, 0, 0 };
    int pf = ChoosePixelFormat(dummyDC, &pfd);
    SetPixelFormat(dummyDC, pf, &pfd);
    HGLRC dummyContext = wglCreateContext(dummyDC);
    wglMakeCurrent(dummyDC, dummyContext);

    PFNWGLCREATECONTEXTATTRIBSARBPROC wglCreateContextAttribsARB =
        (PFNWGLCREATECONTEXTATTRIBSARBPROC)wglGetProcAddress("wglCreateContextAttribsARB");
    int attribs[] = {
        WGL_CONTEXT_MAJOR_VERSION_ARB, 3,
        WGL_CONTEXT_MINOR_VERSION_ARB, 3,
        WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB,
        0
    };
    HGLRC glContext = wglCreateContextAttribsARB ? wglCreateContextAttribsARB(dummyDC, NULL, attribs) : dummyContext;
    wglMakeCurrent(dummyDC, glContext);

    // Resolve FBO entry points
    glGenFramebuffersPtr = (PFNGLGENFRAMEBUFFERSPROC)wglGetProcAddress("glGenFramebuffers");
    glBindFramebufferPtr = (PFNGLBINDFRAMEBUFFERPROC)wglGetProcAddress("glBindFramebuffer");
    glFramebufferTexture2DPtr = (PFNGLFRAMEBUFFERTEXTURE2DPROC)wglGetProcAddress("glFramebufferTexture2D");
    glDeleteFramebuffersPtr = (PFNGLDELETEFRAMEBUFFERSPROC)wglGetProcAddress("glDeleteFramebuffers");

    // Initialize projectM
    projectm_handle pm = projectm_create_with_opengl_load_proc(resolve_gl, NULL);
    if (!pm) {
        printf("[ProjectM Host] Error: Failed to create projectM handle\n");
        return 1;
    }

    int currentW = g_renderWidth.load();
    int currentH = g_renderHeight.load();
    projectm_set_window_size(pm, currentW, currentH);
    projectm_set_fps(pm, g_targetFps.load());
    projectm_set_preset_locked(pm, true);
    projectm_set_hard_cut_enabled(pm, false);
    projectm_set_preset_duration(pm, 999999.0);
    projectm_set_soft_cut_duration(pm, 1.0);

    // Setup FBO & Color Texture
    GLuint fbo = 0;
    GLuint texture = 0;
    if (glGenFramebuffersPtr) {
        glGenFramebuffersPtr(1, &fbo);
        glGenTextures(1, &texture);
        glBindTexture(GL_TEXTURE_2D, texture);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, currentW, currentH, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

        glBindFramebufferPtr(GL_FRAMEBUFFER, fbo);
        glFramebufferTexture2DPtr(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
        glBindFramebufferPtr(GL_FRAMEBUFFER, 0);
    }

    std::vector<uint8_t> readPixels(currentW * currentH * 4);
    std::vector<uint8_t> framePayload;

    // Start Audio thread
    std::thread audioThread(audio_capture_func, pm);
    audioThread.detach();

    // Watch stdin in background for parent termination
    std::thread stdinWatcher([]() {
        HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
        char ch;
        DWORD bytesRead = 0;
        while (ReadFile(hStdin, &ch, 1, &bytesRead, NULL) && bytesRead > 0) {
            if (ch == 'q' || ch == 'Q') break;
        }
        g_running = false;
    });
    stdinWatcher.detach();

    uint32_t frameIndex = 0;
    auto lastFrameTime = std::chrono::steady_clock::now();
    auto lastFpsCalcTime = std::chrono::steady_clock::now();
    int fpsCounter = 0;
    float measuredFps = 30.0f;

    // Main render loop
    while (g_running) {
        if (g_lockChanged.load()) {
            g_lockChanged = false;
            projectm_set_preset_locked(pm, g_isLocked.load());
        }

        // Handle pending preset switch
        if (g_newPresetPending) {
            std::string nextPath;
            {
                std::lock_guard<std::mutex> lock(g_presetMutex);
                nextPath = g_pendingPresetPath;
                g_newPresetPending = false;
            }
            if (!nextPath.empty()) {
                projectm_load_preset_file(pm, nextPath.c_str(), g_smoothTransition.load());
                projectm_set_preset_locked(pm, g_isLocked.load());
                // Extract preset base filename for display
                size_t slash = nextPath.find_last_of("\\/");
                std::string base = (slash != std::string::npos) ? nextPath.substr(slash + 1) : nextPath;
                if (base.size() > 5 && base.substr(base.size() - 5) == ".milk") {
                    base = base.substr(0, base.size() - 5);
                }
                // If it starts with hash-
                size_t dash = base.find("-");
                if (dash == 64) {
                    base = base.substr(65);
                }
                {
                    std::lock_guard<std::mutex> lock(g_presetMutex);
                    g_currentPresetName = base;
                }
                char statusJson[512];
                snprintf(statusJson, sizeof(statusJson),
                    "{\"type\":\"presetChanged\",\"preset\":\"%s\",\"path\":\"%s\"}",
                    base.c_str(), nextPath.c_str());
                broadcast_ws_text(statusJson);
            }
        }

        // Handle size change
        if (g_sizeChanged.load()) {
            g_sizeChanged = false;
            currentW = g_renderWidth.load();
            currentH = g_renderHeight.load();
            projectm_set_window_size(pm, currentW, currentH);

            if (glGenFramebuffersPtr && fbo) {
                glBindTexture(GL_TEXTURE_2D, texture);
                glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, currentW, currentH, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
            }
            readPixels.resize(currentW * currentH * 4);
        }

        // Check if any clients are listening
        bool hasClients = false;
        {
            std::lock_guard<std::mutex> lock(g_clientMutex);
            hasClients = !g_clients.empty();
        }

        if (!hasClients || !g_isPlaying.load()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
            continue;
        }

        // Frame timing limiter
        int targetFps = g_targetFps.load();
        if (targetFps < 15) targetFps = 15;
        if (targetFps > 60) targetFps = 60;
        int frameIntervalMs = 1000 / targetFps;

        auto now = std::chrono::steady_clock::now();
        auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastFrameTime).count();
        if (elapsedMs < frameIntervalMs) {
            std::this_thread::sleep_for(std::chrono::milliseconds(frameIntervalMs - elapsedMs));
        }
        lastFrameTime = std::chrono::steady_clock::now();

        // Render projectM frame
        if (glGenFramebuffersPtr && fbo) {
            glBindFramebufferPtr(GL_FRAMEBUFFER, fbo);
            glViewport(0, 0, currentW, currentH);
            projectm_opengl_render_frame_fbo(pm, fbo);
            glReadPixels(0, 0, currentW, currentH, GL_RGBA, GL_UNSIGNED_BYTE, readPixels.data());
            glBindFramebufferPtr(GL_FRAMEBUFFER, 0);
        } else {
            glViewport(0, 0, currentW, currentH);
            projectm_opengl_render_frame(pm);
            glReadPixels(0, 0, currentW, currentH, GL_RGBA, GL_UNSIGNED_BYTE, readPixels.data());
        }

        frameIndex++;
        fpsCounter++;
        auto fpsElapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastFpsCalcTime).count();
        if (fpsElapsed >= 1000) {
            measuredFps = (fpsCounter * 1000.0f) / fpsElapsed;
            fpsCounter = 0;
            lastFpsCalcTime = now;
        }

        // Prepare frame packet:
        // [0..3]: 'PM4F'
        // [4..5]: uint16 width
        // [6..7]: uint16 height
        // [8..11]: uint32 frameIndex
        // [12..15]: float measuredFps
        // [16..17]: uint16 presetNameLen
        // [18..18+len-1]: presetName UTF-8
        // Remaining: currentW * currentH * 4 RGBA pixels (flipped vertically for HTML canvas)

        std::string curPreset;
        {
            std::lock_guard<std::mutex> lock(g_presetMutex);
            curPreset = g_currentPresetName;
        }
        uint16_t nameLen = (uint16_t)curPreset.size();

        size_t headerSize = 18 + nameLen;
        size_t pixelSize = currentW * currentH * 4;
        framePayload.resize(headerSize + pixelSize);

        uint8_t* p = framePayload.data();
        p[0] = 'P'; p[1] = 'M'; p[2] = '4'; p[3] = 'F';
        *(uint16_t*)(p + 4) = (uint16_t)currentW;
        *(uint16_t*)(p + 6) = (uint16_t)currentH;
        *(uint32_t*)(p + 8) = frameIndex;
        *(float*)(p + 12) = measuredFps;
        *(uint16_t*)(p + 16) = nameLen;
        if (nameLen > 0) {
            memcpy(p + 18, curPreset.data(), nameLen);
        }

        // Flip image vertically from bottom-left (GL) to top-left (HTML ImageData)
        uint8_t* destPixels = p + headerSize;
        size_t rowStride = currentW * 4;
        for (int y = 0; y < currentH; y++) {
            const uint8_t* srcRow = readPixels.data() + (currentH - 1 - y) * rowStride;
            uint8_t* dstRow = destPixels + y * rowStride;
            memcpy(dstRow, srcRow, rowStride);
        }

        broadcast_ws_binary(framePayload.data(), framePayload.size());
    }

    // Cleanup
    projectm_destroy(pm);

    if (glDeleteFramebuffersPtr && fbo) {
        glDeleteFramebuffersPtr(1, &fbo);
        glDeleteTextures(1, &texture);
    }

    wglMakeCurrent(NULL, NULL);
    wglDeleteContext(glContext);
    ReleaseDC(dummyHwnd, dummyDC);
    DestroyWindow(dummyHwnd);
    return 0;
}
