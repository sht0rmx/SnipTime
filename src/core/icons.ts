import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export const DefaultIcons = {
    file: `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM4OWI0ZmEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQgMkg2YTIgMiAwIDAgMC0yIDJ2MTZhMiAyIDAgMCAwIDIgMmgxMmEyIDIgMCAwIDAgMi0yVjhoLTZ6Ii8+PHBhdGggZD0iTTE0IDJ2NmgyIi8+PC9zdmc+`,
    project: `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNhN2ViZmEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMjIgMTl2LTJhMiAyIDAgMCAwLTItMmgtN2wtMi0zSDlhMiAyIDAgMCAwLTIgMnYxM2EyIDIgMCAwIDAgMiAyaDEwYTIgMiAwIDAgMCAyLTJ6Ii8+PC9zdmc+`
};

export class IconThemeService {
    private iconDefinitions: any = {};
    private fileExtensions: Record<string, string> = {};
    private languageIds: Record<string, string> = {};
    private themePath: string = '';

    constructor() {
        this.loadCurrentTheme();
    }

    private loadCurrentTheme() {
        const themeId = vscode.workspace.getConfiguration('workbench').get('iconTheme');
        if (!themeId) { return; }

        const extension = vscode.extensions.all.find(ext => {
            const themes = ext.packageJSON.contributes?.iconThemes;
            return themes?.some((t: any) => t.id === themeId);
        });

        if (!extension) { return; }

        const themeMetaData = extension.packageJSON.contributes.iconThemes.find((t: any) => t.id === themeId);
        this.themePath = path.join(extension.extensionPath, path.dirname(themeMetaData.path));

        const fullPath = path.join(extension.extensionPath, themeMetaData.path);
        try {
            const content = fs.readFileSync(fullPath, 'utf8');
            const json = JSON.parse(content);
            this.iconDefinitions = json.iconDefinitions || {};
            this.fileExtensions = json.fileExtensions || {};
            this.languageIds = json.languageIds || {};
        } catch (e) {
            console.error('[SnipTime] Failed to parse icon theme JSON', e);
        }
    }

    public getIconUri(webview: vscode.Webview, seed: string, kind: 'language' | 'file'): vscode.Uri | null {
        let iconId: string | undefined;

        if (kind === 'language') {
            iconId = this.languageIds[seed];
        } else {
            const ext = path.extname(seed).replace('.', '');
            iconId = this.fileExtensions[ext] || this.fileExtensions[seed];
        }

        if (!iconId) { iconId = 'file'; }

        const iconDef = this.iconDefinitions[iconId];
        if (!iconDef || !iconDef.iconPath) { return null; }

        const fullIconPath = path.join(this.themePath, iconDef.iconPath);
        return webview.asWebviewUri(vscode.Uri.file(fullIconPath));
    }
}