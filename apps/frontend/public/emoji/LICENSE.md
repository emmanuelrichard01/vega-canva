# Emoji artwork

The SVG files in this folder are the **Flat** style of
[Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji), Copyright (c) Microsoft Corporation,
used under the MIT License.

- Source: https://github.com/microsoft/fluentui-emoji
- Commit: 1ffb34c752ecf5d402f04cfb4b392c77f57c54bc

The files were sanitised and optimised for this project: only drawing
elements and attributes were kept (filters, scripts, styles and any external
references were removed), numbers were rounded to two decimals, and every
`id` was prefixed with the emoji's code so that several emoji can be inlined
into one SVG document. They are otherwise unmodified.

`index.json` orders and groups the emoji following the Unicode emoji-test
data; names and keywords come from the Fluent Emoji metadata.

## License

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```
