# SharedBoard.app third-party notices

SharedBoard.app incorporates the open-source Excalidraw editor, React, the Model Context Protocol SDK, Zod and their dependencies. The Windows portable package also includes the official Node.js runtime. Third-party components retain their respective licenses. This notice does not select a license for the new SharedBoard.app application code.

The distributed ZIP includes:

- **licenses/inventory.json**: exact installed dependency names, versions, declared licenses and paths to collected license texts.
- **licenses/packages/**: license, copyright and notice files copied from the installed production dependency closure, including frontend components compiled into the browser assets.
- **licenses/supplemental/**: original upstream notices missing from installed package roots, plus licenses and provenance for bundled drawing fonts. Its sources.json records their source URLs.
- **licenses/NODE-LICENSE.txt** and **runtime/LICENSE**: the full official Node.js distribution notice, including its bundled components.

The package includes the Excalidraw MIT notice, applicable MIT/Apache/BSD and other dependency notices, and the exact font licenses rather than assuming one license covers every font. The app's own public-release licensing remains a separate project decision.
