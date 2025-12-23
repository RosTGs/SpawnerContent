"""Tkinter interface for Gemini image generation sheets."""
from __future__ import annotations

import threading
import tkinter as tk
from dataclasses import replace
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Dict, List, Optional

from PIL import Image, ImageTk

from .gemini_client import GeminiClient
from .storage import (
    DEFAULT_DESKTOP_PDF,
    SheetRecord,
    export_pdf,
    new_asset_path,
    save_metadata,
)

ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]
RESOLUTIONS = ["1K", "2K", "4K"]
TEMPLATE_FIELDS = ["background", "style", "font", "example", "character"]


class GeminiApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Gemini Sheet Builder")
        self.geometry("1100x750")
        self.minsize(1000, 700)

        self.api_key_var = tk.StringVar(value="")
        self.sheets: List[SheetRecord] = [SheetRecord(name="Sheet 1")]
        self.selected_index = 0
        self._photo_cache: Optional[ImageTk.PhotoImage] = None

        self._build_ui()
        self._load_sheet_into_form()

    # UI construction
    def _build_ui(self) -> None:
        top_bar = ttk.Frame(self, padding=10)
        top_bar.pack(side=tk.TOP, fill=tk.X)

        ttk.Label(top_bar, text="Gemini API Key:").pack(side=tk.LEFT)
        ttk.Entry(top_bar, textvariable=self.api_key_var, width=50, show="*").pack(side=tk.LEFT, padx=5)
        ttk.Button(top_bar, text="Add Sheet", command=self._add_sheet).pack(side=tk.LEFT, padx=5)
        ttk.Button(top_bar, text="Remove Sheet", command=self._remove_sheet).pack(side=tk.LEFT, padx=5)
        ttk.Button(top_bar, text="Save All to PDF", command=self._save_pdf).pack(side=tk.LEFT, padx=5)

        main_area = ttk.Frame(self, padding=10)
        main_area.pack(fill=tk.BOTH, expand=True)

        self.sheet_list = tk.Listbox(main_area, height=20, width=25)
        self.sheet_list.pack(side=tk.LEFT, fill=tk.Y)
        self.sheet_list.bind("<<ListboxSelect>>", lambda _e: self._switch_sheet())
        self._refresh_sheet_list()

        right = ttk.Frame(main_area)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=10)

        form = ttk.Frame(right)
        form.pack(fill=tk.X)

        ttk.Label(form, text="Prompt:").grid(row=0, column=0, sticky=tk.W, pady=5)
        self.prompt_text = tk.Text(form, height=4)
        self.prompt_text.grid(row=0, column=1, columnspan=3, sticky=tk.EW, pady=5)

        ttk.Label(form, text="Aspect Ratio:").grid(row=1, column=0, sticky=tk.W)
        self.aspect_var = tk.StringVar(value=ASPECT_RATIOS[0])
        ttk.Combobox(form, values=ASPECT_RATIOS, textvariable=self.aspect_var, state="readonly", width=10).grid(row=1, column=1, sticky=tk.W)

        ttk.Label(form, text="Resolution:").grid(row=1, column=2, sticky=tk.W)
        self.resolution_var = tk.StringVar(value=RESOLUTIONS[0])
        ttk.Combobox(form, values=RESOLUTIONS, textvariable=self.resolution_var, state="readonly", width=10).grid(row=1, column=3, sticky=tk.W)

        ttk.Label(form, text="Template images:").grid(row=2, column=0, sticky=tk.W, pady=(10, 0))
        self.template_vars: Dict[str, tk.StringVar] = {}
        for idx, field in enumerate(TEMPLATE_FIELDS):
            var = tk.StringVar(value="")
            self.template_vars[field] = var
            ttk.Label(form, text=f"{field.title()}:").grid(row=3 + idx, column=0, sticky=tk.W, pady=2)
            ttk.Entry(form, textvariable=var, width=50, state="readonly").grid(row=3 + idx, column=1, columnspan=2, sticky=tk.W)
            ttk.Button(form, text="Choose", command=lambda f=field: self._choose_file(f)).grid(row=3 + idx, column=3, sticky=tk.W, pady=2)

        button_row = ttk.Frame(right)
        button_row.pack(fill=tk.X, pady=10)
        ttk.Button(button_row, text="Generate", command=self._generate).pack(side=tk.LEFT, padx=5)
        ttk.Button(button_row, text="Regenerate", command=self._generate).pack(side=tk.LEFT, padx=5)

        self.status_var = tk.StringVar(value="Waiting for input...")
        ttk.Label(right, textvariable=self.status_var).pack(anchor=tk.W)

        self.image_label = ttk.Label(right)
        self.image_label.pack(fill=tk.BOTH, expand=True, pady=10)

    # Sheet management
    def _refresh_sheet_list(self) -> None:
        self.sheet_list.delete(0, tk.END)
        for sheet in self.sheets:
            self.sheet_list.insert(tk.END, sheet.name)
        self.sheet_list.selection_set(self.selected_index)

    def _add_sheet(self) -> None:
        new_name = f"Sheet {len(self.sheets) + 1}"
        self.sheets.append(SheetRecord(name=new_name, aspect_ratio=self.aspect_var.get(), resolution=self.resolution_var.get()))
        self.selected_index = len(self.sheets) - 1
        self._refresh_sheet_list()
        self._load_sheet_into_form()

    def _remove_sheet(self) -> None:
        if len(self.sheets) == 1:
            messagebox.showinfo("Cannot remove", "At least one sheet must exist.")
            return
        if 0 <= self.selected_index < len(self.sheets):
            self.sheets.pop(self.selected_index)
            self.selected_index = max(0, self.selected_index - 1)
            self._refresh_sheet_list()
            self._load_sheet_into_form()

    def _switch_sheet(self) -> None:
        selection = self.sheet_list.curselection()
        if selection:
            self.selected_index = selection[0]
            self._load_sheet_into_form()

    def _load_sheet_into_form(self) -> None:
        sheet = self.sheets[self.selected_index]
        self.prompt_text.delete("1.0", tk.END)
        self.prompt_text.insert(tk.END, sheet.prompt)
        self.aspect_var.set(sheet.aspect_ratio)
        self.resolution_var.set(sheet.resolution)
        for key, var in self.template_vars.items():
            var.set(sheet.template_files.get(key, ""))
        self._display_image(sheet.latest_image)
        self.status_var.set("Ready")

    def _capture_form(self) -> SheetRecord:
        sheet = self.sheets[self.selected_index]
        updated = replace(
            sheet,
            prompt=self.prompt_text.get("1.0", tk.END).strip(),
            aspect_ratio=self.aspect_var.get(),
            resolution=self.resolution_var.get(),
            template_files={name: var.get() or None for name, var in self.template_vars.items()},
        )
        self.sheets[self.selected_index] = updated
        return updated

    # Template selection
    def _choose_file(self, field: str) -> None:
        path = filedialog.askopenfilename(title=f"Choose {field} image")
        if path:
            self.template_vars[field].set(path)
            self._capture_form()

    # Generation
    def _generate(self) -> None:
        sheet = self._capture_form()
        if not sheet.prompt:
            messagebox.showwarning("Missing prompt", "Please enter a prompt before generating.")
            return
        api_key = self.api_key_var.get().strip() or None
        client = GeminiClient(api_key=api_key)
        target_path = str(new_asset_path(sheet.name))
        template_files = [path for path in sheet.template_files.values() if path]

        def task() -> None:
            try:
                self._set_status("Generating image...")
                result = client.generate_image(
                    prompt=sheet.prompt,
                    aspect_ratio=sheet.aspect_ratio,
                    resolution=sheet.resolution,
                    template_files=template_files,
                    output_path=target_path,
                )
                updated = replace(sheet, latest_image=result.image_path, text_parts=result.text_parts)
                self.sheets[self.selected_index] = updated
                save_metadata(updated)
                self.after(0, lambda: self._on_generation_complete(updated))
            except Exception as exc:  # noqa: BLE001
                self.after(0, lambda: messagebox.showerror("Generation failed", str(exc)))
                self._set_status("Generation failed.")

        threading.Thread(target=task, daemon=True).start()

    def _on_generation_complete(self, sheet: SheetRecord) -> None:
        self._display_image(sheet.latest_image)
        self._set_status("Generation complete. Preview updated.")

    def _display_image(self, path: Optional[str]) -> None:
        if not path or not Path(path).exists():
            self.image_label.configure(image="", text="No image yet.")
            return
        max_width, max_height = 700, 500
        with Image.open(path) as img:
            img.thumbnail((max_width, max_height))
            self._photo_cache = ImageTk.PhotoImage(img)
            self.image_label.configure(image=self._photo_cache, text="")

    def _set_status(self, message: str) -> None:
        self.status_var.set(message)

    # PDF export
    def _save_pdf(self) -> None:
        images = [sheet.latest_image for sheet in self.sheets if sheet.latest_image]
        if not images:
            messagebox.showinfo("No images", "Generate at least one image before saving to PDF.")
            return
        default_path = DEFAULT_DESKTOP_PDF
        destination = filedialog.asksaveasfilename(
            title="Save PDF",
            initialdir=str(default_path.parent),
            initialfile=default_path.name,
            defaultextension=".pdf",
            filetypes=[("PDF files", "*.pdf")],
        )
        if not destination:
            return
        try:
            saved_path = export_pdf(images, Path(destination))
            messagebox.showinfo("PDF saved", f"Saved to {saved_path}")
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror("Save failed", str(exc))


def main() -> None:
    app = GeminiApp()
    app.mainloop()


if __name__ == "__main__":
    main()

