/*
 * grunt-importsrc
 * https://github.com/kewah/grunt-importsrc
 *
 * Copyright (c) 2013 Antoine Lehurt
 * Licensed under the MIT license.
 */

'use strict';

var path = require('path');
var util = require('../lib/util');

module.exports = function(grunt) {
  // Lodash
  var _ = grunt.util._;

  // relative path to the html file
  var htmlRootPath;

  /**
   * Add the HTML root path to a file path.
   * @param  {String} filepath  File path that you want to add the root path.
   * @return {String}           htmlRootPath + filepath
   */

  function addRootPathTo(filepath) {
    return path.join(htmlRootPath, filepath);
  }

  /**
   * Convert a string ('path.to.smth') to an object (path: {to: {smth: {}}})
   * @param  {String} str
   * @return {Object}
   */

  function stringToGruntConfigObject(str) {
    var cfg = grunt.config.data;
    var props = str.split('.');
    var obj, lastProp;

    props.forEach(function(prop, i) {
      if (i === props.length - 1) {
        lastProp = prop;
        return;
      }
      obj = (!obj) ? cfg[prop] : obj[prop];
    });

    return {
      obj: obj,
      lastProp: lastProp
    };
  }

  // `importsrc` task
  grunt.registerMultiTask('importsrc', 'Import file paths of scripts and stylesheets from HTML files', function() {
    this.files.forEach(function(file) {
      if (!file.src.length) {
        // The source file does not exist.
        return;
      }

      var html = file.src.map(extractDataFromHTML);
      grunt.file.write(file.dest, html);
    });
  });

  /**
   * Open the HTML file and detect if there are `importsrc` sections.
   * @param  {String} htmlFilepath Path of the file that will be read.
   * @return {String}              HTML content after the task execution.
   */

  function extractDataFromHTML(htmlFilepath) {
    var content = grunt.file.read(htmlFilepath);

    // define the relative path to the html file, to import files declared in the HTML.
    htmlRootPath = htmlFilepath.substr(0, htmlFilepath.lastIndexOf('/') + 1);

    // detect if there are an `importsrc` sections.
    var sections = util.extractSectionsData(content);

    if (!sections) {
      // stop the task.
      return;
    }

    // execute the task using the parameters defined in the HTML.
    sections.forEach(function(section) {
      var concatParam = util.extractConcatParam(section);
      var updateParam = util.extractUpdateParam(section);
      var outputFilepath;

      if (concatParam) {
        outputFilepath = concatSourceFiles(section, concatParam);
      }

      if (updateParam) {
        outputFilepath = updateGruntTask(section, updateParam);
      }

      // replace section with the output file path.
      var extension = util.getFileExtension(outputFilepath);
      var replacement;

      if (extension === '.js') {
        replacement = '<script src="' + outputFilepath + '"></script>';
      } else if (extension === '.css') {
        replacement = '<link rel="stylesheet" href="' + outputFilepath + '">';
      }

      content = content.replace(new RegExp(util.escapeRegExp(section), 'gi'), replacement);
    });

    return content;
  }

  /**
   * Concatenates files present in a section.
   * @param  {String} section
   * @param  {String} concatDest
   * @return {String}             The output file path.
   */

  function concatSourceFiles(section, concatDest) {
    // extract file paths that will be read and concatenated.
    var sources = util.extractFilePaths(section, util.getFileExtension(concatDest)).map(addRootPathTo).filter(function(filepath) {
      if (!grunt.file.exists(filepath)) {
        grunt.log.warn('Source file "' + filepath + '" not found.');
        return false;
      } else {
        return true;
      }
    });

    var concatFile = sources.map(grunt.file.read).join(grunt.util.normalizelf(grunt.util.linefeed));
    grunt.file.write(concatDest, concatFile);

    // display a message
    grunt.log.ok('Files have been concatenated to "' + concatDest + '"');
    grunt.log.writeln('\nConcatenated files :');
    grunt.log.writeln('    - ' + grunt.log.wordlist(sources, {
      separator: '\n    - '
    }));
    grunt.log.writeln('\n');

    return concatDest;
  }

  /**
   * Update an existing Grunt task (like uglify, mincss, etc.)
   * @param  {String} section
   * @param  {String} taskToUpdate
   * @return {String}              The output file path.
   */

  function updateGruntTask(section, taskToUpdate) {
    var destFilepath = util.extractReplaceParam(section);
    var destFileExtension = util.getFileExtension(destFilepath);

    // Grunt has different syntax format for config of tasks (see https://github.com/gruntjs/grunt/wiki/grunt)
    // - compact & list: 'dist/built.js': ['src/file1.js', 'src/file2.js']
    //    ex: uglify.dist.files['dist/built.js'] (<= brackets) return ['src/file1.js', 'src/file2.js']
    // - full: env: {src: ['src/file1.css', 'src/file2.css'], dest: ... }
    //    ex: mincss.compress.src (<= no brackets) return ['src/file1.css', 'src/file2.css']
    //
    // To detect those different formats, I just check if there are brackets in the `taskToUpdate` value.
    if (util.containsBrackets(taskToUpdate)) {
      updateGruntTaskWithCompactFormat(section, taskToUpdate, destFileExtension);
    } else {
      updateGruntTaskWithFullFormat(section, taskToUpdate, destFileExtension);
    }

    return destFilepath;
  }

  function updateGruntTaskWithCompactFormat(section, taskToUpdate, destFileExtension) {
    var insideBrackets = util.extractValueInsideBrackets(taskToUpdate);
    var cfg = stringToGruntConfigObject(util.removeBrackets(taskToUpdate));
    var taskData = cfg.obj[cfg.lastProp];
    var taskDestFile;

    // get the last prop of the object to be able to update it after.
    insideBrackets.forEach(function(prop, i) {
      if (i === insideBrackets.length - 1) {
        taskDestFile = prop;
        return;
      }

      taskData = taskData[prop];
    });

    if (!taskData[taskDestFile]) {
      taskData[taskDestFile] = [];
    }

    // extract file paths from the html to add it to the task that we are updating.
    var sources = util.extractFilePaths(section, destFileExtension).map(addRootPathTo);
    var updatedTask = _.union(taskData[taskDestFile], sources);

    updateGruntTaskMessage(taskToUpdate, taskData[taskDestFile], updatedTask);

    cfg.obj[cfg.lastProp][taskDestFile] = updatedTask;
  }

  function updateGruntTaskWithFullFormat(section, taskToUpdate, destFileExtension) {
    var cfg = stringToGruntConfigObject(taskToUpdate);
    var taskData = cfg.obj[cfg.lastProp];

    if (!taskData) {
      taskData = cfg.obj[cfg.lastProp] = [];
    }

    // extract file paths from the html to add it to the task that we are updating.
    var sources = util.extractFilePaths(section, destFileExtension).map(addRootPathTo);
    var updatedTask = _.union(taskData, sources);

    updateGruntTaskMessage(taskToUpdate, taskData, updatedTask);

    cfg.obj[cfg.lastProp] = updatedTask;
  }

  /**
   * Display a message in the terminal.
   */

  function updateGruntTaskMessage(taskName, beforeUpdate, afterUpdate) {
    grunt.log.ok('Task ' + taskName + ' has been updated');
    grunt.log.subhead('  from:');
    grunt.log.writeln('    - ' + grunt.log.wordlist((_.isArray(beforeUpdate)) ? beforeUpdate : [beforeUpdate], {
      separator: '\n    - '
    }));
    grunt.log.subhead('  to:');
    grunt.log.writeln('    - ' + grunt.log.wordlist(afterUpdate, {
      separator: '\n    - '
    }));

    grunt.log.writeln('\n');
  }

};