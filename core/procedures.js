/**
 * @license
 * Visual Blocks Editor
 *
 * Copyright 2012 Google Inc.
 * https://developers.google.com/blockly/
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Utility functions for handling procedures.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

/**
 * @name Blockly.Procedures
 * @namespace
 **/
goog.provide('Blockly.Procedures');

goog.require('Blockly.Blocks');
goog.require('Blockly.constants');
goog.require('Blockly.Events.BlockChange');
goog.require('Blockly.Field');
goog.require('Blockly.Names');
goog.require('Blockly.Workspace');


/**
 * Constant to separate procedure names from variables and generated functions
 * when running generators.
 * @deprecated Use Blockly.PROCEDURE_CATEGORY_NAME
 */
Blockly.Procedures.NAME_TYPE = Blockly.PROCEDURE_CATEGORY_NAME;

/**
 * Set of open procedure folders.
 * @type {!Set.<string>}
 * @private
 */
Blockly.Procedures.openFolders_ = new Set();

/**
 * Global (cross-target) procedure mutations provided by the host (scratch-gui).
 * These are procedures whose definitions live in the stage but should be
 * callable from every target. Each entry is a `<mutation>` DOM element.
 * @type {!Array.<Element>}
 */
Blockly.Procedures.globalProcedureMutations = [];

/**
 * Replace the set of global procedure mutations shown in every target's flyout.
 * @param {!Array.<Element>} mutations Array of `<mutation>` DOM elements.
 * @public
 */
Blockly.Procedures.setGlobalProcedureMutations = function(mutations) {
  Blockly.Procedures.globalProcedureMutations = mutations || [];
};

/**
 * Check if a folder is currently open.
 * @param {string} folderName Name of the folder.
 * @return {boolean} True if the folder is open.
 */
Blockly.Procedures.isFolderOpen = function(folderName) {
  return Blockly.Procedures.openFolders_.has(folderName);
};

/**
 * Set the open/closed state of a folder.
 * @param {string} folderName Name of the folder.
 * @param {boolean} isOpen True to open the folder, false to close it.
 */
Blockly.Procedures.setFolderOpen = function(folderName, isOpen) {
  if (isOpen) {
    Blockly.Procedures.openFolders_.add(folderName);
  } else {
    Blockly.Procedures.openFolders_.delete(folderName);
  }
  // Refresh the flyout to show the updated state
  var workspace = Blockly.getMainWorkspace();
  if (workspace && workspace.getToolbox) {
    var toolbox = workspace.getToolbox();
    if (toolbox && toolbox.refreshSelection) {
      toolbox.refreshSelection();
    }
  }
};

/**
 * Toggle the open/closed state of a folder.
 * @param {string} folderName Name of the folder.
 */
Blockly.Procedures.toggleFolder = function(folderName) {
  var isOpen = Blockly.Procedures.isFolderOpen(folderName);
  Blockly.Procedures.setFolderOpen(folderName, !isOpen);
};

/**
 * Find all user-created procedure definitions in a workspace.
 * @param {!Blockly.Workspace} root Root workspace.
 * @return {!Array.<!Array.<!Array>>} Pair of arrays, the
 *     first contains procedures without return variables, the second with.
 *     Each procedure is defined by a three-element list of name, parameter
 *     list, and return value boolean.
 */
Blockly.Procedures.allProcedures = function(root) {
  var blocks = root.getAllBlocks();
  var proceduresReturn = [];
  var proceduresNoReturn = [];
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].getProcedureDef) {
      var tuple = blocks[i].getProcedureDef();
      if (tuple) {
        if (tuple[2]) {
          proceduresReturn.push(tuple);
        } else {
          proceduresNoReturn.push(tuple);
        }
      }
    }
  }
  proceduresNoReturn.sort(Blockly.Procedures.procTupleComparator_);
  proceduresReturn.sort(Blockly.Procedures.procTupleComparator_);
  return [proceduresNoReturn, proceduresReturn];
};

/**
 * Find all user-created procedure definition mutations in a workspace.
 * @param {!Blockly.Workspace} root Root workspace.
 * @return {!Array.<Element>} Array of mutation xml elements.
 * @package
 */
Blockly.Procedures.allProcedureMutations = function(root) {
  var blocks = root.getAllBlocks();
  var mutations = [];
  var seen = Object.create(null);
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type == Blockly.PROCEDURES_PROTOTYPE_BLOCK_TYPE) {
      var mutation = blocks[i].mutationToDom(/* opt_generateShadows */ true);
      if (mutation) {
        seen[mutation.getAttribute('proccode')] = true;
        mutations.push(mutation);
      }
    }
  }
  var pending = Blockly.Procedures.deferredProcedureMutations_(root);
  for (var j = 0; j < pending.length; j++) {
    if (!seen[pending[j].getAttribute('proccode')]) {
      mutations.push(pending[j]);
    }
  }
  return mutations;
};

/**
 * Find procedure definition mutations in scripts that a deferred workspace load
 * has not materialized into blocks yet.
 * @param {!Blockly.Workspace} root Root workspace.
 * @return {!Array.<Element>} Array of mutation xml elements.
 * @private
 */
Blockly.Procedures.deferredProcedureMutations_ = function(root) {
  var mutations = [];
  if (!root.getDeferredScripts) {
    return mutations;
  }
  var scripts = root.getDeferredScripts();
  for (var i = 0; i < scripts.length; i++) {
    var prototypeMutation = null;
    var hasReturn = false;
    if (scripts[i].desc) {
      Blockly.Xml.forEachDescBlock(scripts[i].desc, scripts[i].ctx, function(d) {
        if (d.opcode == Blockly.PROCEDURES_PROTOTYPE_BLOCK_TYPE && d.mutation) {
          prototypeMutation = Blockly.Xml.mutationDescToDom_(d.mutation);
        } else if (d.opcode == Blockly.PROCEDURES_RETURN_BLOCK_TYPE) {
          hasReturn = true;
        }
      });
    } else {
      var xmlBlocks = scripts[i].xmlNode.getElementsByTagName('block');
      for (var j = 0; j < xmlBlocks.length; j++) {
        var type = xmlBlocks[j].getAttribute('type');
        if (type == Blockly.PROCEDURES_PROTOTYPE_BLOCK_TYPE) {
          var children = xmlBlocks[j].childNodes;
          for (var k = 0; k < children.length; k++) {
            if (children[k].nodeName.toLowerCase() == 'mutation') {
              prototypeMutation = children[k];
              break;
            }
          }
        } else if (type == Blockly.PROCEDURES_RETURN_BLOCK_TYPE) {
          hasReturn = true;
        }
      }
    }
    if (!prototypeMutation) {
      continue;
    }
    var mutation = prototypeMutation.cloneNode(false);
    mutation.setAttribute('generateshadows', true);
    if (hasReturn) {
      // ponytail: boolean-returning definitions show as round reporters until the
      // script renders and the toolbox refreshes; the XML alone doesn't carry the
      // output shape. Harmless while Blockly.Procedures.ENFORCE_TYPES is false.
      mutation.setAttribute('return', Blockly.PROCEDURES_CALL_TYPE_REPORTER);
    }
    mutations.push(mutation);
  }
  return mutations;
};

/**
 * Sorts an array of procedure definition mutations alphabetically.
 * (Does not mutate the given array.)
 * @param {!Array.<Element>} mutations Array of mutation xml elements.
 * @return {!Array.<Element>} Sorted array of mutation xml elements.
 * @private
 */
Blockly.Procedures.sortProcedureMutations_ = function(mutations) {
  var newMutations = mutations.slice();

  newMutations.sort(function(a, b) {
    var procCodeA = a.getAttribute('proccode');
    var procCodeB = b.getAttribute('proccode');

    return Blockly.scratchBlocksUtils.compareStrings(procCodeA, procCodeB);
  });

  return newMutations;
};

/**
 * Comparison function for case-insensitive sorting of the first element of
 * a tuple.
 * @param {!Array} ta First tuple.
 * @param {!Array} tb Second tuple.
 * @return {number} -1, 0, or 1 to signify greater than, equality, or less than.
 * @private
 */
Blockly.Procedures.procTupleComparator_ = function(ta, tb) {
  return Blockly.scratchBlocksUtils.compareStrings(ta[0], tb[0]);
};

/**
 * Ensure two identically-named procedures don't exist.
 * @param {string} name Proposed procedure name.
 * @param {!Blockly.Block} block Block to disambiguate.
 * @return {string} Non-colliding name.
 */
Blockly.Procedures.findLegalName = function(name, block) {
  if (block.isInFlyout) {
    // Flyouts can have multiple procedures called 'do something'.
    return name;
  }
  while (!Blockly.Procedures.isLegalName_(name, block.workspace, block)) {
    // Collision with another procedure.
    var r = name.match(/^(.*?)(\d+)$/);
    if (!r) {
      name += '2';
    } else {
      name = r[1] + (parseInt(r[2], 10) + 1);
    }
  }
  return name;
};

/**
 * Does this procedure have a legal name?  Illegal names include names of
 * procedures already defined.
 * @param {string} name The questionable name.
 * @param {!Blockly.Workspace} workspace The workspace to scan for collisions.
 * @param {Blockly.Block=} opt_exclude Optional block to exclude from
 *     comparisons (one doesn't want to collide with oneself).
 * @return {boolean} True if the name is legal.
 * @private
 */
Blockly.Procedures.isLegalName_ = function(name, workspace, opt_exclude) {
  return !Blockly.Procedures.isNameUsed(name, workspace, opt_exclude);
};

/**
 * Return if the given name is already a procedure name.
 * @param {string} name The questionable name.
 * @param {!Blockly.Workspace} workspace The workspace to scan for collisions.
 * @param {Blockly.Block=} opt_exclude Optional block to exclude from
 *     comparisons (one doesn't want to collide with oneself).
 * @return {boolean} True if the name is used, otherwise return false.
 */
Blockly.Procedures.isNameUsed = function(name, workspace, opt_exclude) {
  if (workspace.materializeAllScripts) {
    workspace.materializeAllScripts();
  }

  // Name of the block being renamed (if any), so a global procedure can keep
  // its own name without colliding with itself in the global check below.
  var excludeProcCode = null;
  if (opt_exclude) {
    if (opt_exclude.getProcCode) {
      excludeProcCode = opt_exclude.getProcCode();
    } else if (opt_exclude.getProcedureDef) {
      var excludeDef = opt_exclude.getProcedureDef();
      if (excludeDef) {
        excludeProcCode = excludeDef[0];
      }
    }
  }

  var blocks = workspace.getAllBlocks();
  // Iterate through every block and check the name.
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i] == opt_exclude) {
      continue;
    }
    if (blocks[i].getProcedureDef) {
      var procName = blocks[i].getProcedureDef();
      if (Blockly.Names.equals(procName[0], name)) {
        return true;
      }
    }
  }

  // Also check global (cross-target) procedures stored in the stage, so a
  // sprite cannot create a custom block whose name collides with a global one.
  var globalMutations = Blockly.Procedures.globalProcedureMutations || [];
  for (var j = 0; j < globalMutations.length; j++) {
    var globalProcCode = globalMutations[j].getAttribute('proccode');
    if (Blockly.Names.equals(globalProcCode, name) &&
        !(excludeProcCode && Blockly.Names.equals(globalProcCode, excludeProcCode))) {
      return true;
    }
  }

  return false;
};

/**
 * Rename a procedure.  Called by the editable field.
 * @param {string} name The proposed new name.
 * @return {string} The accepted name.
 * @this {Blockly.Field}
 */
Blockly.Procedures.rename = function(name) {
  // Strip leading and trailing whitespace.  Beyond this, all names are legal.
  name = name.replace(/^[\s\xa0]+|[\s\xa0]+$/g, '');

  // Ensure two identically-named procedures don't exist.
  var legalName = Blockly.Procedures.findLegalName(name, this.sourceBlock_);
  var oldName = this.text_;
  if (oldName != name && oldName != legalName) {
    // Rename any callers.
    var blocks = this.sourceBlock_.workspace.getAllBlocks();
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i].renameProcedure) {
        blocks[i].renameProcedure(oldName, legalName);
      }
    }
  }
  return legalName;
};

/**
 * Construct the blocks required by the flyout for the procedure category.
 * @param {!Blockly.Workspace} workspace The workspace contianing procedures.
 * @return {!Array.<!Element>} Array of XML block elements.
 */
Blockly.Procedures.flyoutCategory = function(workspace) {
  var xmlList = [];

  Blockly.Procedures.addCreateButton_(workspace, xmlList);

  // Create call blocks for each procedure defined in the workspace
  var mutations = Blockly.Procedures.allProcedureMutations(workspace);
  mutations = Blockly.Procedures.sortProcedureMutations_(mutations);

  // Merge in global (cross-target) procedures defined in the stage, so that
  // they can be called from any target. Skip any whose procCode is already
  // present (e.g. when the stage itself is the current target).
  var seenProcCodes = {};
  for (var si = 0; si < mutations.length; si++) {
    seenProcCodes[mutations[si].getAttribute('proccode')] = true;
  }
  var globalMutations = Blockly.Procedures.globalProcedureMutations || [];
  for (var gi = 0; gi < globalMutations.length; gi++) {
    var globalMutation = globalMutations[gi];
    var globalProcCode = globalMutation.getAttribute('proccode');
    if (!seenProcCodes[globalProcCode]) {
      var clonedGlobalMutation = globalMutation.cloneNode(false);
      clonedGlobalMutation.setAttribute('generateshadows', true);
      mutations.push(clonedGlobalMutation);
      seenProcCodes[globalProcCode] = true;
    }
  }
  mutations = Blockly.Procedures.sortProcedureMutations_(mutations);
  
  // Group procedures by folder
  var folderGroups = {};
  var unfoldered = [];
  
  for (var i = 0; i < mutations.length; i++) {
    var mutation = mutations[i].cloneNode(false);
    var folderName = mutation.getAttribute('customFolder');
    
    if (folderName && folderName.trim()) {
      if (!folderGroups[folderName]) {
        folderGroups[folderName] = [];
      }
      folderGroups[folderName].push(mutation);
    } else {
      unfoldered.push(mutation);
    }
  }
  
  // Add unfoldered procedures first
  for (var i = 0; i < unfoldered.length; i++) {
    var mutation = unfoldered[i];
    var procCode = mutation.getAttribute('proccode');
    var returnType = Blockly.Procedures.getProcedureReturnType(procCode, workspace);
    if (returnType !== Blockly.PROCEDURES_CALL_TYPE_STATEMENT) {
      mutation.setAttribute('return', returnType);
    }
    var block = goog.dom.createDom('block');
    block.setAttribute('type', 'procedures_call');
    block.setAttribute('gap', 12);
    block.appendChild(mutation);
    xmlList.push(block);
  }
  
  // Add folders and their procedures
  var folderNames = Object.keys(folderGroups).sort();
  for (var f = 0; f < folderNames.length; f++) {
    var folderName = folderNames[f];
    var procedures = folderGroups[folderName];
    var isOpen = Blockly.Procedures.isFolderOpen(folderName);
    
    // Add clickable folder button
    var folderButton = goog.dom.createDom('button');
    var folderIcon = isOpen ? '▼' : '▶';
    folderButton.setAttribute('text', folderIcon + ' ' + folderName);
    folderButton.setAttribute('callbackKey', 'TOGGLE_FOLDER_' + folderName);
    var callbackKey = 'TOGGLE_FOLDER_' + folderName;
    workspace.registerButtonCallback(callbackKey, function(folderName) {
      return function() {
        Blockly.Procedures.toggleFolder(folderName);
      };
    }(folderName));
    
    if (f === 0 && unfoldered.length > 0) {
      folderButton.setAttribute('gap', 24);
    }
    xmlList.push(folderButton);
    
    // Add procedure blocks in this folder (only if folder is open)
    if (isOpen) {
      for (var p = 0; p < procedures.length; p++) {
        var mutation = procedures[p];
        var procCode = mutation.getAttribute('proccode');
        var returnType = Blockly.Procedures.getProcedureReturnType(procCode, workspace);
        if (returnType !== Blockly.PROCEDURES_CALL_TYPE_STATEMENT) {
          mutation.setAttribute('return', returnType);
        }
        var block = goog.dom.createDom('block');
        block.setAttribute('type', 'procedures_call');
        block.setAttribute('gap', 12);
        block.appendChild(mutation);
        xmlList.push(block);
      }
    }
  }

  var showReturn = true;
  if (showReturn) {
    var returnBlock = goog.dom.createDom('block');
    returnBlock.setAttribute('type', Blockly.PROCEDURES_RETURN_BLOCK_TYPE);
    returnBlock.setAttribute('gap', 12);
    var returnBlockValue = goog.dom.createDom('value');
    returnBlockValue.setAttribute('name', 'VALUE');
    var returnBlockShadow = goog.dom.createDom('shadow');
    returnBlockShadow.setAttribute('type', 'text');
    var returnBlockField = goog.dom.createDom('field');
    returnBlockField.setAttribute('name', 'TEXT');
    returnBlockShadow.appendChild(returnBlockField);
    returnBlockValue.appendChild(returnBlockShadow);
    returnBlock.appendChild(returnBlockValue);
    xmlList.unshift(returnBlock);
  }

  return xmlList;
};

/**
 * Create the "Make a Block..." button.
 * @param {!Blockly.Workspace} workspace The workspace contianing procedures.
 * @param {!Array.<!Element>} xmlList Array of XML block elements to add to.
 * @private
 */
Blockly.Procedures.addCreateButton_ = function(workspace, xmlList) {
  var button = goog.dom.createDom('button');
  var msg = Blockly.Msg.NEW_PROCEDURE;
  var callbackKey = 'CREATE_PROCEDURE';
  var callback = function() {
    Blockly.Procedures.createProcedureDefCallback_(workspace);
  };
  button.setAttribute('text', msg);
  button.setAttribute('callbackKey', callbackKey);
  workspace.registerButtonCallback(callbackKey, callback);
  xmlList.push(button);
};

/**
 * Find all callers of a named procedure.
 * @param {string} name Name of procedure (procCode in scratch-blocks).
 * @param {!Blockly.Workspace} ws The workspace to find callers in.
 * @param {!Blockly.Block} definitionRoot The root of the stack where the
 *     procedure is defined.
 * @param {boolean} allowRecursive True if the search should include recursive
 *     procedure calls.  False if the search should ignore the stack starting
 *     with definitionRoot.
 * @return {!Array.<!Blockly.Block>} Array of caller blocks.
 * @package
 */
Blockly.Procedures.getCallers = function(name, ws, definitionRoot,
    allowRecursive) {
  var allBlocks = [];
  // Callers in scripts that are not rendered still have to be found: this is
  // what renaming a procedure updates, and what refuses to delete a used one.
  if (ws.materializeAllScripts) {
    ws.materializeAllScripts();
  }
  var topBlocks = ws.getTopBlocks();

  // Start by deciding which stacks to investigate.
  for (var i = 0; i < topBlocks.length; i++) {
    var block = topBlocks[i];
    if (block.id == definitionRoot.id && !allowRecursive) {
      continue;
    }
    allBlocks.push.apply(allBlocks, block.getDescendants(false));
  }

  var callers = [];
  for (var i = 0; i < allBlocks.length; i++) {
    var block = allBlocks[i];
    if (block.type == Blockly.PROCEDURES_CALL_BLOCK_TYPE ) {
      var procCode = block.getProcCode();
      if (procCode && procCode == name) {
        callers.push(block);
      }
    }
  }
  return callers;
};

/**
 * Find and edit all callers with a procCode using a new mutation.
 * @param {string} name Name of procedure (procCode in scratch-blocks).
 * @param {!Blockly.Workspace} ws The workspace to find callers in.
 * @param {!Element} mutation New mutation for the callers.
 * @package
 */
Blockly.Procedures.mutateCallersAndPrototype = function(name, ws, mutation) {
  var defineBlock = Blockly.Procedures.getDefineBlock(name, ws);
  var prototypeBlock = Blockly.Procedures.getPrototypeBlock(name, ws);
  if (defineBlock && prototypeBlock) {
    var callers = Blockly.Procedures.getCallers(name,
        defineBlock.workspace, defineBlock, true /* allowRecursive */);
    callers.push(prototypeBlock);
    Blockly.Events.setGroup(true);
    for (var i = 0, caller; caller = callers[i]; i++) {
      var oldMutationDom = caller.mutationToDom();
      var oldMutation = oldMutationDom && Blockly.Xml.domToText(oldMutationDom);

      // Preserve the block's existing shape
      var mutationToReplaceWith = mutation.cloneNode(false);
      mutationToReplaceWith.setAttribute('return', oldMutationDom.getAttribute('return'));
      caller.domToMutation(mutationToReplaceWith);

      var newMutationDom = caller.mutationToDom();
      var newMutation = newMutationDom && Blockly.Xml.domToText(newMutationDom);
      if (oldMutation != newMutation) {
        Blockly.Events.fire(new Blockly.Events.BlockChange(
            caller, 'mutation', null, oldMutation, newMutation));
      }
    }
    Blockly.Events.setGroup(false);
  } else {
    alert('No define block on workspace'); // TODO decide what to do about this.
  }
};

/**
 * Find the global procedure mutation for the given procCode. Global
 * (cross-target) procedures are defined in the stage and their mutations are
 * collected by the host (scratch-gui) into globalProcedureMutations.
 * @param {string} procCode The identifier of the procedure.
 * @return {?Element} The mutation DOM element, or null if not found.
 * @package
 */
Blockly.Procedures.getGlobalProcedureMutation = function(procCode) {
  var globalMutations = Blockly.Procedures.globalProcedureMutations || [];
  for (var i = 0; i < globalMutations.length; i++) {
    if (Blockly.Names.equals(
        globalMutations[i].getAttribute('proccode'), procCode)) {
      return globalMutations[i];
    }
  }
  return null;
};

/**
 * Find the definition block for the named procedure.
 * @param {string} procCode The identifier of the procedure.
 * @param {!Blockly.Workspace} workspace The workspace to search.
 * @return {Blockly.Block} The procedure definition block, or null not found.
 * @package
 */
Blockly.Procedures.getDefineBlock = function(procCode, workspace) {
  // Assume that a procedure definition is a top block.
  var blocks = workspace.getTopBlocks(false);
  for (var i = 0; i < blocks.length; i++) {
    if (blocks[i].type == Blockly.PROCEDURES_DEFINITION_BLOCK_TYPE) {
      var prototypeBlock = blocks[i].getInput('custom_block').connection.targetBlock();
      if (prototypeBlock.getProcCode && prototypeBlock.getProcCode() == procCode) {
        return blocks[i];
      }
    }
  }
  return null;
};

/**
 * Find the prototype block for the named procedure.
 * @param {string} procCode The identifier of the procedure.
 * @param {!Blockly.Workspace} workspace The workspace to search.
 * @return {Blockly.Block} The procedure prototype block, or null not found.
 * @package
 */
Blockly.Procedures.getPrototypeBlock = function(procCode, workspace) {
  var defineBlock = Blockly.Procedures.getDefineBlock(procCode, workspace);
  if (defineBlock) {
    return defineBlock.getInput('custom_block').connection.targetBlock();
  }
  return null;
};

/**
 * Create a mutation for a brand new custom procedure.
 * @return {Element} The mutation for a new custom procedure
 * @package
 */
Blockly.Procedures.newProcedureMutation = function() {
  var mutationText = '<xml>' +
      '<mutation' +
      ' proccode="' + Blockly.Msg['PROCEDURE_DEFAULT_NAME'] + '"' +
      ' argumentids="[]"' +
      ' argumentnames="[]"' +
      ' argumentdefaults="[]"' +
      ' warp="false">' +
      '</mutation>' +
      '</xml>';
  return Blockly.Xml.textToDom(mutationText).firstChild;
};

/**
 * Callback to create a new procedure custom command block.
 * @param {!Blockly.Workspace} workspace The workspace to create the new procedure on.
 * @private
 */
Blockly.Procedures.createProcedureDefCallback_ = function(workspace) {
  Blockly.Procedures.externalProcedureDefCallback(
      Blockly.Procedures.newProcedureMutation(),
      Blockly.Procedures.createProcedureCallbackFactory_(workspace)
  );
};

/**
 * Callback factory for adding a new custom procedure from a mutation.
 * @param {!Blockly.Workspace} workspace The workspace to create the new procedure on.
 * @return {function(?Element)} callback for creating the new custom procedure.
 * @private
 */
Blockly.Procedures.createProcedureCallbackFactory_ = function(workspace) {
  return function(mutation) {
    if (mutation) {
      var blockText = '<xml>' +
          '<block type="procedures_definition">' +
          '<statement name="custom_block">' +
          '<shadow type="procedures_prototype">' +
          Blockly.Xml.domToText(mutation) +
          '</shadow>' +
          '</statement>' +
          '</block>' +
          '</xml>';
      var blockDom = Blockly.Xml.textToDom(blockText).firstChild;
      Blockly.Events.setGroup(true);
      var block = Blockly.Xml.domToBlock(blockDom, workspace);
      var scale = workspace.scale; // To convert from pixel units to workspace units
      // Position the block so that it is at the top left of the visible workspace,
      // padded from the edge by 30 units. Position in the top right if RTL.
      var posX = -workspace.scrollX;
      if (workspace.RTL) {
        posX += workspace.getMetrics().contentWidth - 30;
      } else {
        posX += 30;
      }
      block.moveBy(posX / scale, (-workspace.scrollY + 30) / scale);
      block.scheduleSnapAndBump();
      Blockly.Events.setGroup(false);
    }
  };
};

/**
 * Callback to open the modal for editing custom procedures.
 * @param {!Blockly.Block} block The block that was right-clicked.
 * @private
 */
Blockly.Procedures.editProcedureCallback_ = function(block) {
  // Edit can come from one of three block types (call, define, prototype)
  // Normalize by setting the block to the prototype block for the procedure.
  if (block.type == Blockly.PROCEDURES_DEFINITION_BLOCK_TYPE) {
    var input = block.getInput('custom_block');
    if (!input) {
      alert('Bad input'); // TODO: Decide what to do about this.
      return;
    }
    var conn = input.connection;
    if (!conn) {
      alert('Bad connection'); // TODO: Decide what to do about this.
      return;
    }
    var innerBlock = conn.targetBlock();
    if (!innerBlock ||
        !innerBlock.type == Blockly.PROCEDURES_PROTOTYPE_BLOCK_TYPE) {
      alert('Bad inner block'); // TODO: Decide what to do about this.
      return;
    }
    block = innerBlock;
  } else if (block.type == Blockly.PROCEDURES_CALL_BLOCK_TYPE) {
    // This is a call block, find the prototype corresponding to the procCode.
    // Make sure to search the correct workspace, call block can be in flyout.
    var callProcCode = block.getProcCode();
    var workspaceToSearch = block.workspace.isFlyout ?
        block.workspace.targetWorkspace : block.workspace;
    block = Blockly.Procedures.getPrototypeBlock(
        callProcCode, workspaceToSearch);
    // A global (cross-target) procedure is defined in the stage, so its
    // prototype is not present in a sprite's workspace. Fall back to the
    // global procedure mutations collected by the host so the editor can
    // still be opened from any target.
    if (!block) {
      var globalMutation = Blockly.Procedures.getGlobalProcedureMutation(
          callProcCode);
      if (globalMutation) {
        Blockly.Procedures.externalProcedureDefCallback(
            globalMutation,
            Blockly.Procedures.editGlobalProcedureCallbackFactory_(
                callProcCode, workspaceToSearch)
        );
        return;
      }
    }
  }
  // Block now refers to the procedure prototype block, it is safe to proceed.
  Blockly.Procedures.externalProcedureDefCallback(
      block.mutationToDom(),
      Blockly.Procedures.editProcedureCallbackFactory_(block)
  );
};

/**
 * Callback factory for editing an existing custom procedure.
 * @param {!Blockly.Block} block The procedure prototype block being edited.
 * @return {function(?Element)} Callback for editing the custom procedure.
 * @private
 */
Blockly.Procedures.editProcedureCallbackFactory_ = function(block) {
  return function(mutation) {
    if (mutation) {
      Blockly.Procedures.mutateCallersAndPrototype(block.getProcCode(),
          block.workspace, mutation);
    }
  };
};

/**
 * Callback to apply an edit to a global (cross-target) procedure. The host
 * (scratch-gui) overrides this to update the stage definition and broadcast
 * the change to every target's flyout/workspace.
 * @param {string} procCode The old procCode of the procedure being edited.
 * @param {!Element} mutation The new mutation for the procedure.
 * @param {!Blockly.Workspace} workspace The workspace the edit originated from.
 * @public
 */
Blockly.Procedures.externalGlobalProcedureEditCallback =
    function(procCode, mutation, workspace) {
  // Delegate to the workspace-level path when the prototype is available here
  // (e.g. when editing from the stage itself), so callers in this workspace
  // stay in sync through the usual mutateCallersAndPrototype flow.
  var prototypeBlock = Blockly.Procedures.getPrototypeBlock(procCode, workspace);
  if (prototypeBlock) {
    Blockly.Procedures.mutateCallersAndPrototype(procCode, workspace, mutation);
    return;
  }
  alert('External global procedure editor must override Blockly.Procedures.externalGlobalProcedureEditCallback');
};

/**
 * Callback factory for editing a global (cross-target) custom procedure whose
 * definition lives in the stage. Editing can be initiated from any target;
 * the mutation is applied through the host-provided global edit callback.
 * @param {string} procCode The procCode of the procedure being edited.
 * @param {!Blockly.Workspace} workspace The workspace the edit originated from.
 * @return {function(?Element)} Callback for editing the global procedure.
 * @private
 */
Blockly.Procedures.editGlobalProcedureCallbackFactory_ =
    function(procCode, workspace) {
  return function(mutation) {
    if (mutation) {
      Blockly.Procedures.externalGlobalProcedureEditCallback(
          procCode, mutation, workspace);
    }
  };
};

/**
 * Callback to create a new procedure custom command block.
 * @public
 */
Blockly.Procedures.externalProcedureDefCallback = function(/** mutator, callback */) {
  alert('External procedure editor must be override Blockly.Procedures.externalProcedureDefCallback');
};

/**
 * Make a context menu option for editing a custom procedure.
 * This appears in the context menu for procedure definitions and procedure
 * calls.
 * @param {!Blockly.BlockSvg} block The block where the right-click originated.
 * @return {!Object} A menu option, containing text, enabled, and a callback.
 * @package
 */
Blockly.Procedures.makeEditOption = function(block) {
  var editOption = {
    enabled: true,
    text: Blockly.Msg.EDIT_PROCEDURE,
    callback: function() {
      Blockly.Procedures.editProcedureCallback_(block);
    }
  };
  return editOption;
};

Blockly.Procedures.makeChangeTypeOption = function(block) {
  var isStatement = block.getReturn() === Blockly.PROCEDURES_CALL_TYPE_STATEMENT;
  var option = {
    enabled: true,
    text: isStatement ? Blockly.Msg.PROCEDURES_TO_REPORTER : Blockly.Msg.PROCEDURES_TO_STATEMENT,
    callback: function() {
      var newType;
      if (isStatement) {
        var procCode = block.getProcCode();
        var workspace = block.workspace;
        var actualReturnType = Blockly.Procedures.getProcedureReturnType(procCode, workspace);
        // If the definition is boolean-shaped, then the reporter should be boolean-shaped,
        // otherwise normal reporter shaped.
        newType = (
          actualReturnType === Blockly.PROCEDURES_CALL_TYPE_BOOLEAN ?
          actualReturnType :
          Blockly.PROCEDURES_CALL_TYPE_REPORTER
        );
      } else {
        newType = Blockly.PROCEDURES_CALL_TYPE_STATEMENT;
      }

      Blockly.Events.setGroup(true);
      try {
        Blockly.Procedures.changeReturnType(block, newType);
      } finally {
        Blockly.Events.setGroup(false);
      }
    }
  };
  return option;
};

Blockly.Procedures.changeReturnType = function(block, returnType) {
  block.unplug(true);
  var workspace = block.workspace;
  var xml = Blockly.Xml.blockToDom(block);
  var xy = block.getRelativeToSurfaceXY();
  block.dispose();

  var mutation = xml.querySelector('mutation');
  mutation.setAttribute('return', returnType);

  var newBlock = Blockly.Xml.domToBlock(xml, workspace);
  newBlock.moveBy(xy.x, xy.y);
};

/**
 * Callback to show the procedure definition corresponding to a custom command
 * block.
 * TODO(#1136): Implement.
 * @param {!Blockly.Block} block The block that was right-clicked.
 * @private
 */
Blockly.Procedures.showProcedureDefCallback_ = function(block) {
  alert('TODO(#1136): implement showing procedure definition (procCode was "' +
      block.procCode_ + '")');
};

/**
 * Make a context menu option for showing the definition for a custom procedure,
 * based on a right-click on a custom command block.
 * @param {!Blockly.BlockSvg} block The block where the right-click originated.
 * @return {!Object} A menu option, containing text, enabled, and a callback.
 * @package
 */
Blockly.Procedures.makeShowDefinitionOption = function(block) {
  var option = {
    enabled: true,
    text: Blockly.Msg.SHOW_PROCEDURE_DEFINITION,
    callback: function() {
      Blockly.Procedures.showProcedureDefCallback_(block);
    }
  };
  return option;
};

/**
 * Callback to try to delete a custom block definitions.
 * @param {string} procCode The identifier of the procedure to delete.
 * @param {!Blockly.Block} definitionRoot The root block of the stack that
 *     defines the custom procedure.
 * @return {boolean} True if the custom procedure was deleted, false otherwise.
 * @package
 */
Blockly.Procedures.deleteProcedureDefCallback = function(procCode,
    definitionRoot) {
  var callers = Blockly.Procedures.getCallers(procCode,
      definitionRoot.workspace, definitionRoot, false /* allowRecursive */);
  if (callers.length > 0) {
    return false;
  }

  var workspace = definitionRoot.workspace;

  // Delete the whole stack.
  Blockly.Events.setGroup(true);
  definitionRoot.dispose();
  Blockly.Events.setGroup(false);

  // TODO (#1354) Update this function when '_' is removed
  // Refresh toolbox, so caller doesn't appear there anymore
  workspace.refreshToolboxSelection_();

  return true;
};

/**
 * If true, the user will be able to manually override the shape of procedure call blocks.
 */
Blockly.Procedures.USER_CAN_CHANGE_CALL_TYPE = true;

/**
 * If false, a round procedure call reporter can be dropped into any input, including boolean ones.
 */
Blockly.Procedures.ENFORCE_TYPES = false;

/**
 * If true, the return block will always be available. If false, either create a block that requires
 * returns or call workspace.enableProcedureReturns() to enable return blocks.
 */
Blockly.Procedures.DEFAULT_ENABLE_RETURNS = false;

/**
 * @param {string} procCode The procedure code
 * @param {Blockly.Workspace} workspace The workspace
 * @returns {number} The type of the return block
 */
Blockly.Procedures.getProcedureReturnType = function(procCode, workspace) {
  var defineBlock = Blockly.Procedures.getDefineBlock(procCode, workspace);
  if (!defineBlock) {
    return Blockly.PROCEDURES_CALL_TYPE_STATEMENT;
  }
  return Blockly.Procedures.getBlockReturnType(defineBlock);
};

/**
 * @param {Blockly.Workspace} workspace The workspace
 * @returns {Record<string, number>} The return type of each procedure in the workspace.
 */
Blockly.Procedures.getAllProcedureReturnTypes = function(workspace) {
  var result = Object.create(null);
  var blocks = workspace.getTopBlocks(false);
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (block.type == Blockly.PROCEDURES_DEFINITION_BLOCK_TYPE && !block.isInsertionMarker()) {
      var procCode = block.getInput('custom_block').connection.targetBlock().getProcCode();
      // To match behavior of getDefineBlock, if multiple instances of this procedure are
      // defined, only use the first one.
      if (!Object.prototype.hasOwnProperty.call(result, procCode)) {
        result[procCode] = Blockly.Procedures.getBlockReturnType(block);
      }
    }
  }
  return result;
};

/**
 * @param {Blockly.Block} block The block
 * @returns {number} The type of the return block
 */
Blockly.Procedures.getBlockReturnType = function(block) {
  var hasSeenBooleanReturn = false;
  /** @type {Blockly.Block[]} */
  var descendants = block.getDescendants();
  for (var i = 0; i < descendants.length; i++) {
    if (descendants[i].type === Blockly.PROCEDURES_RETURN_BLOCK_TYPE) {
      // The block at i + 1 should be the block inside of the return block.
      // Even if the return block is missing its input, this will still be fine, because the
      // next block should a stacked block which won't be hexagon-shaped.
      if (i + 1 < descendants.length && descendants[i + 1].outputShape_ === Blockly.OUTPUT_SHAPE_HEXAGONAL) {
        // keep searching, because there may be other, non-boolean returns in this function definition.
        hasSeenBooleanReturn = true;
      } else {
        return Blockly.PROCEDURES_CALL_TYPE_REPORTER;
      }
    }
  }
  if (hasSeenBooleanReturn) {
    return Blockly.PROCEDURES_CALL_TYPE_BOOLEAN;
  } else {
    return Blockly.PROCEDURES_CALL_TYPE_STATEMENT;
  }
};
