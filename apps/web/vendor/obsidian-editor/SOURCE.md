Source: https://github.com/zacharyyamaoka/like_obsidian_md_viewer
Revision: 7b9d1aa5ca648a642369cb1ea7f2d31158a477ca

Full source tree retained, including upstream contract tests. The host adapter and 1a2o theme live in utils/notes-editor. See LICENSE and UPSTREAM.md for attribution and fork details.

Host compatibility patches:

- Removed a now-unused TypeScript expect-error in searchPanel.ts.
- Wrapped task checkbox widgets in inline-preview.ts so their measured bounds include the trailing text gap. Together with utils/notes-editor/host.css, this keeps empty-list carets aligned with populated items without changing checkbox controls.
