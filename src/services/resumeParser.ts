import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');

export class ResumeParser {
    /**
     * Main entry point - parse any file type
     */
    async parseFile(file: File): Promise<string> {
        const fileType = file.type;
        let text = '';

        try {
            if (fileType === 'application/pdf') {
                text = await this.parsePDF(file);
            } else if (
                fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                fileType === 'application/msword'
            ) {
                text = await this.parseDOCX(file);
            } else if (fileType === 'text/plain') {
                text = await this.parseText(file);
            } else {
                throw new Error('Unsupported file type');
            }

            return text;
        } catch (error) {
            console.error('Error parsing file:', error);
            throw error;
        }
    }

    /**
     * Parse PDF file
     */
    private async parsePDF(file: File): Promise<string> {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item: any) => item.str)
                .join(' ');
            fullText += pageText + '\n';
        }

        return fullText;
    }

    /**
     * Parse DOCX file
     */
    private async parseDOCX(file: File): Promise<string> {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    }

    /**
     * Parse plain text file
     */
    private async parseText(file: File): Promise<string> {
        return await file.text();
    }
}

export const resumeParser = new ResumeParser();