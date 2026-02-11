# Aullevo - AI Form Filler

> **Auto-fill forms using your resume data powered by Gemini AI.**

Aullevo is a browser extension designed to streamline the job application process. It intelligently analyzes web forms and automatically fills them using data extracted from your resume (PDF or DOCX), powered by Google's Gemini AI.

## 🚀 Features

- **AI-Powered Form Filling**: Utilizes Google Gemini AI to understand form context and fill fields accurately.
- **Resume Parsing**: Supports parsing of both PDF and DOCX resume formats.
- **Privacy-Focused**: Your data is processed securely.
- **Modern Stack**: Built with React, TypeScript, and Vite for a fast and responsive experience.
- **Dockerized**: specific container support for easy deployment and testing.

## 🛠️ Tech Stack

- **Frontend Framework**: [React](https://react.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **AI Integration**: [Google GenAI SDK](https://github.com/google/google-api-nodejs-client)
- **Document Processing**: `mammoth` (DOCX), `pdfjs-dist` (PDF)
- **Containerization**: Docker & Docker Compose
- **Server**: Nginx (for serving the built extension/app in container)

## 📦 Installation & Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Docker](https://www.docker.com/) (optional, for containerized run)
- A Google Gemini API Key

### Local Development

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Jullemyth122/aullevo.git
    cd aullevo
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the development server:**
    ```bash
    npm run dev
    ```

4.  **Load Extension in Chrome:**
    - Open Chrome and navigate to `chrome://extensions/`.
    - Enable "Developer mode" in the top right.
    - Click "Load unpacked".
    - Select the `dist` directory created by the build (run `npm run build` first if `dist` doesn't exist).

### Production Build

To create a production-ready build:

```bash
npm run build
```

The output will be in the `dist` folder.

## 🐳 Docker Support

You can run the application containerized using Docker.

1.  **Build and Run:**
    ```bash
    docker-compose up --build
    ```

    This will start the Nginx server on port `5173` serving the static files.

2.  **Stop Containers:**
    ```bash
    docker-compose down
    ```

## 🤝 Contributing & Collaboration

We welcome contributions! whether it's fixing bugs, improving documentation, or proposing new features.

### How to Contribute

1.  Fork the repository.
2.  Create a new branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

### Areas for Improvement
- Enhancing AI prompt engineering for better form field recognition.
- Adding support for more document formats.
- improving UI/UX for the popup interface.

## 📄 License

[MIT](LICENSE)
