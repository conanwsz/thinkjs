'use strict';

import fs from 'fs';
import path from 'path';

/**
 * watch compile
 */
export default class {
  /**
   * store compiled files last mtime
   * @type {Object}
   */
  compiledMtime = {};
  /**
   * compiled error files
   * @type {Array}
   */
  compiledErrorFiles = [];
  /**
   * allow file ext in src path
   * @type {Array}
   */
  allowFileExt = ['.js', '.ts'];
  /**
   * constructor
   * @param  {Array} args []
   * @return {}         []
   */
  constructor(...args){
    this.init(...args);
  }
  /**
   * init
   * @param  {String} srcPath []
   * @param  {String} outPath []
   * @param  {Boolean} log     []
   * @return {}         []
   */
  init(srcPath, outPath, options = {}, callback){
    this.srcPath = srcPath;
    this.outPath = outPath;
    this.options = options;
    this.callback = callback;
  }
  /**
   * compile single file
   * @param  {String} file     []
   * @param  {Boolean} onlyCopy []
   * @return {}          []
   */
  compileFile(file, onlyCopy){
    let filePath = `${this.srcPath}${think.sep}${file}`;
    let content = fs.readFileSync(filePath, 'utf8');

    //when get file content empty, maybe file is locked
    if(!content){
      return;
    }
    // only copy file content
    if(onlyCopy){
      fs.writeFileSync(`${this.outPath}${think.sep}${file}`, content);
      return;
    }

    try{
      if(this.options.type === 'ts'){
        this.compileByTypeScript(content, file);
      }else{
        this.compileByBabel(content, file);
      }
      return true;
    }catch(e){

      think.log(colors => {
        return colors.red(`compile file ${file} error`);
      }, 'COMPILE');
      think.log(e);

      e.message = 'Compile Error: ' + e.message;
      think.compileError = e;
    }
  }
  /**
   * typescript compile
   * @return {} []
   */
  compileByTypeScript(content, file){
    let ts = require('typescript');
    let startTime = Date.now();
    let diagnostics = [];
    let result = ts.transpile(content, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES5
    }, file, diagnostics);
    //has error
    if(diagnostics.length){
      let firstDiagnostics = diagnostics[0];
      let {line, character} = firstDiagnostics.file.getLineAndCharacterOfPosition(firstDiagnostics.start);
      let message = ts.flattenDiagnosticMessageText(firstDiagnostics.messageText, '\n');
      throw new Error(`${message} on Line ${line + 1}, Character ${character}`);
    }
    if(this.options.log){
      think.log(`Compile file ${file}`, 'TypeScript', startTime);
    }
    //change file extname to js
    file = file.replace('.ts', '.js');
    let saveFile = `${this.outPath}${think.sep}${file}`;
    think.mkdir(path.dirname(saveFile));
    fs.writeFileSync(saveFile, result);
  }
  /**
   * babel compile
   * @return {} []
   */
  compileByBabel(content, file){
    let startTime = Date.now();
    let retainLines = this.options.retainLines;
    //babel not export default property
    //so can not use `import babel from 'babel-core'`
    let babel = require('babel-core');
    let data = babel.transform(content, {
      filename: file,
      retainLines: retainLines === undefined ? true : retainLines,
      presets: ['es2015-loose', 'stage-1'],
      plugins: ['transform-runtime']
    });
    if(this.options.log){
      think.log(`Compile file ${file}`, 'BABEL', startTime);
    }
    think.mkdir(path.dirname(`${this.outPath}${think.sep}${file}`));
    fs.writeFileSync(`${this.outPath}${think.sep}${file}`, data.code);
  }
  /**
   * src file is deleted, but app file also exist
   * then delete app file
   * @return {} []
   */
  getSrcDeletedFiles(srcFiles, appFiles){
    let srcFilesWithoutExt = srcFiles.map(item => {
      return item.replace(/\.\w+$/, '');
    });
    return appFiles.filter(file => {
      let extname = path.extname(file);
      if(this.allowFileExt.indexOf(extname) === -1){
        return;
      }
      let fileWithoutExt = file.replace(/\.\w+$/, '');
      //src file not exist
      if(srcFilesWithoutExt.indexOf(fileWithoutExt) === -1){
        let filepath = this.outPath + think.sep + file;
        fs.unlinkSync(filepath);
        return true;
      }
    }).map(file => {
      return this.outPath + think.sep + file;
    });
  }
  /**
   * compile
   * @return {} []
   */
  compile(){
    let files = think.getFiles(this.srcPath, true);
    let appFiles = think.getFiles(this.outPath, true);
    let changedFiles = this.getSrcDeletedFiles(files, appFiles);

    if(!this.compiledErrorFiles.length){
      think.compileError = null;
    }

    files.forEach(file => {
      let extname = path.extname(file);
      //if is not js file, only copy
      if(this.allowFileExt.indexOf(extname) === -1){
        this.compileFile(file, true);
        return;
      }
      let mTime = fs.statSync(`${this.srcPath}${think.sep}${file}`).mtime.getTime();
      let outFile = `${this.outPath}${think.sep}${file}`;

      if(this.options.type === 'ts'){
        outFile = outFile.replace(/\.ts$/, '.js');
      }

      if(think.isFile(outFile)){
        let outmTime = fs.statSync(outFile).mtime.getTime();
        //if compiled file mtime is after than source file, return
        if(outmTime > mTime){
          return;
        }
      }
      if(!this.compiledMtime[file] || mTime > this.compiledMtime[file]){
        let ret = this.compileFile(file);
        if(ret){
          changedFiles.push(path.normalize(`${this.outPath}${think.sep}${file}`));
        }
        
        this.compiledMtime[file] = mTime;

        if(ret){
          let index = this.compiledErrorFiles.indexOf(file);
          if(index > -1){
            this.compiledErrorFiles.splice(index, 1);
          }
        }else{
          this.compiledErrorFiles.push(file);
        }
      }
    });
    //notify auto reload service to clear file cache
    if(changedFiles.length && this.callback){
      this.callback(changedFiles);
    }
    setTimeout(this.compile.bind(this), 100);
  }
  /**
   * run
   * @return {} []
   */
  run(){
    this.compile();
  }
}