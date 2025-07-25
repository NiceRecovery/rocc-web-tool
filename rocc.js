export class RoccController {
    constructor(baudRate = 9600) {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.baudRate = baudRate;
        this.textEncoder = new TextEncoder();
        this.lineBuffer = '';
        this.lineResolvers = [];
        this.lineReaderActive = false;
        this.lineReaderAbortController = null;
        this.lineReaderReader = null;  // 👈 add this
    }

    async connect() {
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: this.baudRate });

        const encoderStream = new TextEncoderStream();
        this.writer = encoderStream.writable.getWriter();
        encoderStream.readable.pipeTo(this.port.writable);

        this.textDecoder = new TextDecoder(); // No decoder stream!
        this.lineBuffer = '';
        this.lineResolvers = [];

        // DO NOT lock port.readable here
        this.startLineReader(); // soft loop using getReader + releaseLock
    }

    startLineReader() {
        if (this.lineReaderActive) return;

        this.lineReaderAbortController = new AbortController();
        const signal = this.lineReaderAbortController.signal;

        const loop = async () => {
            this.lineReaderActive = true;

            while (this.port?.readable && !signal.aborted) {
                const reader = this.port.readable.getReader();
                this.lineReaderReader = reader; // 👈 store it

                try {
                    while (!signal.aborted) {
                        const { value, done } = await reader.read();
                        if (done || signal.aborted) break;
                        if (!value) continue;

                        const text = this.textDecoder.decode(value, { stream: true });
                        this.lineBuffer += text;

                        let lineEnd;
                        while ((lineEnd = this.lineBuffer.indexOf('\n')) >= 0) {
                            const line = this.lineBuffer.slice(0, lineEnd + 1);
                            this.lineBuffer = this.lineBuffer.slice(lineEnd + 1);

                            const resolver = this.lineResolvers.shift();
                            if (resolver) resolver(line);
                        }
                    }
                } catch (err) {
                    if (!signal.aborted) console.error('lineReader error:', err);
                } finally {
                    reader.releaseLock(); // ✅ IMPORTANT
                    this.lineReaderReader = null;
                }
            }

            this.lineReaderActive = false;
        };

        loop();
    }

    stopLineReader() {
        if (this.lineReaderAbortController) {
            this.lineReaderAbortController.abort();
            this.lineReaderAbortController = null;
        }

        if (this.lineReaderReader) {
            try {
                this.lineReaderReader.releaseLock();  // ✅ ensure release
            } catch (err) {
                console.warn('Reader already released or invalid');
            }
            this.lineReaderReader = null;
        }

        this.lineReaderActive = false;
    }

    async disconnect() {
        if (this.reader) await this.reader.cancel();
        if (this.writer) await this.writer.close();
        if (this.port) await this.port.close();
    }

    async authenticate(secretKey = 'nVVD1by7jB]Mf%3q3dwq]M~j2F3,op62') {
        try {
            const challengeHex = await this.sendCommand('chlng');
            if (!challengeHex) return false;

            const challengeBytes = this.hexToBytes(challengeHex);
            const secretBytes = new TextEncoder().encode(secretKey);

            const hmac = await this.computeHmacSha256(secretBytes, challengeBytes);
            const hmacHex = Array.from(new Uint8Array(hmac))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase();

            const response = await this.sendCommand('auth', hmacHex);

            return response === 'OK';
        } catch (err) {
            console.error('Authentication failed:', err);
            return false;
        }
    }

    async setTime() {
        try {
            const now = new Date();
            const formatted = this.formatDateTime(now);
            const response = await this.sendCommand('time', formatted);
            return response === 'OK';
        } catch (err) {
            console.error('setTime failed:', err);
            return false;
        }
    }

    async readFile(srcFilename) {
        try {
            const sizeStr = await this.sendCommand('fsize', srcFilename);
            const fileSize = parseInt(sizeStr);
            if (isNaN(fileSize)) throw new Error('Invalid file size received');

            const chunks = [];
            let received = 0;

            // Set up a binary reader
            const reader = this.port.readable.getReader();
            await this.sendCommandNoResp('fread', srcFilename);

            while (received < fileSize) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    received += value.length;
                }
            }

            reader.releaseLock();

            if (received === fileSize) {
                const blob = new Blob(chunks, { type: 'application/octet-stream' });
                this.downloadBlob(blob, srcFilename);
                return true;
            } else {
                console.warn(`Expected ${fileSize} bytes, got ${received}`);
                return false;
            }

        } catch (err) {
            console.error('readFile failed:', err);
            return false;
        }
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async readTextFile(srcFilename) {
        // Step 1: Get file size (uses line-based reading)
        const sizeStr = await this.sendCommand('fsize', srcFilename);
        const fileSize = parseInt(sizeStr);
        if (isNaN(fileSize)) throw new Error('Invalid file size');

        // Step 2: Stop the line reader BEFORE raw stream reading
        this.stopLineReader();

        // Step 3: Start file transfer
        await this.sendCommandNoResp('fread', srcFilename);

        while (this.lineReaderActive) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const reader = this.port.readable.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        let text = '';

        while (received < fileSize) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
                text += decoder.decode(value, { stream: true });
                received += value.length;
            }
        }

        text += decoder.decode(); // flush remainder
        reader.releaseLock();

        // Step 4: Resume line-based reader
        this.startLineReader();

        // Step 5: Download CSV
        const blob = new Blob([text], { type: 'text/csv' });
        this.downloadBlob(blob, srcFilename);
        return true;
    }


    downloadBlob(blob, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
    }


    formatDateTime(date) {
        // Matches: MM/dd/yy-HH:mm:ss
        const pad = (n) => n.toString().padStart(2, '0');

        const MM = pad(date.getMonth() + 1);
        const dd = pad(date.getDate());
        const yy = pad(date.getFullYear() % 100);
        const HH = pad(date.getHours());
        const mm = pad(date.getMinutes());
        const ss = pad(date.getSeconds());

        return `${MM}/${dd}/${yy}-${HH}:${mm}:${ss}`;
    }


    hexToBytes(hexStr) {
        const bytes = [];
        for (let i = 0; i < hexStr.length; i += 2) {
            bytes.push(parseInt(hexStr.substr(i, 2), 16));
        }
        return new Uint8Array(bytes);
    }

    async computeHmacSha256(keyBytes, msgBytes) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );

        return crypto.subtle.sign('HMAC', cryptoKey, msgBytes);
    }

    async sendCommand(cmd, arg = '') {
        try {
            const fullCmd = `${cmd}${arg}\r\n`;
            await this.writer.write(fullCmd);

            const line = await this.readLine();
            return line.trim();
        } catch (err) {
            console.error('sendCommand error:', err);
            return null;
        }
    }

    async sendCommandNoResp(cmd, arg = '') {
        try {
            const fullCmd = `${cmd}${arg}\r\n`;
            await this.writer.write(fullCmd);
        } catch (err) {
            console.error('sendCommandNoResp error:', err);
        }
    }

    readLine() {
        return new Promise((resolve) => {
            this.lineResolvers.push(resolve);
        });
    }
}
