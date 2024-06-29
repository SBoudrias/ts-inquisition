import json5 from 'json5'

import globby from 'globby'
import _, { uniq } from 'lodash'
import os from 'os'
// @ts-expect-error
import unpad from 'unpad'
import path from 'path'
import ts, { CompilerOptions } from 'typescript'
import { readFileSync, writeFileSync } from 'fs'
const tsJsonPath = path.join(process.cwd(), 'tsconfig.json')

console.log('path', tsJsonPath)
const tsconfig = json5.parse(readFileSync(tsJsonPath, 'utf8'))

const compilerOptions = _.omit(tsconfig.compilerOptions, ['moduleResolution'])
compilerOptions.noEmit = true
compilerOptions.lib = ['lib.dom.d.ts', `${process.cwd()}/types/custom.d.ts`]

function nthIndex(str: string, pat: string, n: number) {
  const L = str.length
  let i = -1
  while (n-- && i++ < L) {
    i = str.indexOf(pat, i)
    if (i < 0) break
  }
  return i
}

const insertAt = (str: string, sub: string, pos: number) =>
  `${str.slice(0, pos)}${sub}${str.slice(pos)}`

export async function runGlobAndModifyTsFiles(
  folder: string,
  breadcrumbDate = true
) {
  const globPath = path.join(process.cwd(), `${folder}/*.{ts,tsx,mts,mtsx}`)
  console.log('runGlobAndModifyTsFiles -> globPath', globPath)
  const files = await globby([globPath])

  files && addExpectErrors(files, compilerOptions, breadcrumbDate)
}

function addExpectErrors(
  fileNames: string[],
  options: CompilerOptions,
  breadcrumbDate: boolean
) {
  const program = ts.createProgram(fileNames, options)
  const allDiagnostics = ts.getPreEmitDiagnostics(program)
  const errorLinesByFiles: Record<string, number[]> = {}

  allDiagnostics.forEach((diagnostic) => {
    if (diagnostic.file) {
      const { fileName } = diagnostic.file
      if (fileNames.indexOf(fileName) < 0) {
        return
      }
      if (!errorLinesByFiles[fileName]) {
        errorLinesByFiles[fileName] = []
      }

      const { line } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start as number
      )

      if ([2724, 2307].includes(diagnostic.code)) {
        // bad import, let's keep those
        return
      }
      errorLinesByFiles[fileName].push(line)
    } else {
      console.log(
        `${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
      )
    }
  })
  const breadcrumb = breadcrumbDate
    ? ' ' + new Date().toLocaleString().split(',')[0]
    : ''

  Object.entries(errorLinesByFiles).forEach(([file, badLines]) => {
    let fileContent = readFileSync(file, 'utf8')
    const badLinesDeduped = uniq(badLines)
    let lineShift = 0
    badLinesDeduped.forEach((line) => {
      // console.log(`line ${line + 1}`);
      const indexOfTheLine = nthIndex(fileContent, os.EOL, line + lineShift)
      const currentLine = fileContent.substring(
        indexOfTheLine,
        nthIndex(fileContent, os.EOL, line + lineShift + 1)
      )
      const unpaddedCurrentLine = unpad(currentLine)
      if (file.endsWith('tsx')) {
        const prevChar = fileContent[indexOfTheLine - 1]

        // console.log('addExpectErrors -> prevChar', prevChar);
        // console.log(
        //   'addExpectErrors -> unpaddedCurrentLine',
        //   unpaddedCurrentLine
        // );

        if (
          ['>', '}'].includes(prevChar) &&
          ['<', '{'].includes(unpaddedCurrentLine[0])
        ) {
          // this is JSX formatted with prettier
          fileContent = insertAt(
            fileContent,
            `${os.EOL}${`  {/* @ts-expect-error ${breadcrumb}*/}`.padStart(
              currentLine.length - unpaddedCurrentLine.length
            )}`,
            indexOfTheLine
          )
        } else {
          fileContent = insertAt(
            fileContent,
            `${os.EOL}${`  // @ts-expect-error${breadcrumb}`.padStart(
              currentLine.length - unpaddedCurrentLine.length
            )}`,
            indexOfTheLine
          )
        }
      } else {
        fileContent = insertAt(
          fileContent,
          `${os.EOL}${`  // @ts-expect-error${breadcrumb}`.padStart(
            currentLine.length - unpaddedCurrentLine.length
          )}`,
          indexOfTheLine
        )
      }

      lineShift += 1
    })
    writeFileSync(file, fileContent, 'utf8')
    console.log(`${badLinesDeduped.length} error/s expected in ${file}`)
  })
}
