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

'use strict';

goog.provide('Blockly.Blocks.operators');

goog.require('Blockly.Blocks');
goog.require('Blockly.Colours');
goog.require('Blockly.constants');
goog.require('Blockly.ScratchBlocks.VerticalExtensions');


Blockly.ScratchBlocks.OperatorUtils = {};

Blockly.ScratchBlocks.OperatorUtils.arrowsHidden = false;

Blockly.ScratchBlocks.OperatorUtils.setArrowsHidden = function(hidden) {
  hidden = !!hidden;
  Blockly.ScratchBlocks.OperatorUtils.arrowsHidden = hidden;
  var db = Blockly.Workspace.WorkspaceDB_;
  for (var id in db) {
    var workspace = db[id];
    if (!workspace || !workspace.getAllBlocks) continue;
    var blocks = workspace.getAllBlocks(false);
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.inputPrefix_ && block.updateShape_) {
        block.updateShape_();
      }
    }
  }
};

Blockly.FieldOperatorButton = function(iconSrc, handlerName) {
  Blockly.FieldOperatorButton.superClass_.constructor.call(
      this, iconSrc, 12, 18, handlerName === 'plus' ? '+' : '-');
  this.handlerName_ = handlerName;
};
goog.inherits(Blockly.FieldOperatorButton, Blockly.FieldImage);

Blockly.FieldOperatorButton.prototype.init = function() {
  if (this.fieldGroup_) return;
  Blockly.FieldOperatorButton.superClass_.init.call(this);
  this.imageElement_.style.cursor = 'pointer';
  this.mouseDownWrapper_ = Blockly.bindEventWithChecks_(
      this.imageElement_, 'mousedown', this, this.onMouseDown_);
};

Blockly.FieldOperatorButton.prototype.dispose = function() {
  if (this.mouseDownWrapper_) {
    Blockly.unbindEvent_(this.mouseDownWrapper_);
    this.mouseDownWrapper_ = null;
  }
  Blockly.FieldOperatorButton.superClass_.dispose.call(this);
};

Blockly.FieldOperatorButton.prototype.onMouseDown_ = function(e) {
  e.stopPropagation();
  e.preventDefault();
  var block = this.sourceBlock_;
  if (block && !block.isInFlyout && block.workspace && !block.workspace.options.readOnly &&
      block[this.handlerName_]) {
    block[this.handlerName_]();
  }
};

Blockly.ScratchBlocks.OperatorUtils.makeButtonIcon_ = function(isPlus) {
  var points = isPlus ? 'M4 5 L9.5 9 L4 13 Z' : 'M8 5 L2.5 9 L8 13 Z';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="18" ' +
    'viewBox="0 0 12 18"><path d="' + points + '" fill="#fff" stroke="#fff" ' +
    'stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
};

Blockly.ScratchBlocks.OperatorUtils.makeButtonField = function(handlerName) {
  var icon = Blockly.ScratchBlocks.OperatorUtils.makeButtonIcon_(handlerName === 'plus');
  return new Blockly.FieldOperatorButton(icon, handlerName);
};

Blockly.ScratchBlocks.OperatorUtils.attachShadow_ = function(input, shadowType) {
  if (!shadowType) return;
  var fieldName = shadowType === 'text' ? 'TEXT' : 'NUM';
  var fieldValue = '';
  Blockly.Events.disable();
  var newBlock;
  try {
    newBlock = this.workspace.newBlock(shadowType);
    newBlock.setFieldValue(fieldValue, fieldName);
    newBlock.setShadow(true);
    if (!this.isInsertionMarker()) {
      newBlock.initSvg();
      newBlock.render(false);
    }
  } finally {
    Blockly.Events.enable();
  }
  if (Blockly.Events.isEnabled()) {
    Blockly.Events.fire(new Blockly.Events.BlockCreate(newBlock));
  }
  newBlock.outputConnection.connect(input.connection);
};

Blockly.ScratchBlocks.OperatorUtils.MUTATOR_MIXIN = {
  mutationToDom: function() {
    var container = document.createElement('mutation');
    container.setAttribute('itemcount', this.itemCount_);
    return container;
  },
  domToMutation: function(xmlElement) {
    var count = parseInt(xmlElement.getAttribute('itemcount'), 10);
    this.itemCount_ = (count >= this.minItems_) ? count : this.minItems_;
    this.updateShape_();
  },
  mutationToDomText_: function() {
    var dom = this.mutationToDom();
    return dom ? Blockly.Xml.domToText(dom) : null;
  },
  fireMutationChange_: function(oldExtra) {
    if (Blockly.Events.isEnabled()) {
      Blockly.Events.fire(new Blockly.Events.BlockChange(
          this, 'mutation', null, oldExtra, this.mutationToDomText_()));
    }
  },
  plus: function() {
    var oldExtra = this.mutationToDomText_();
    this.itemCount_++;
    this.updateShape_(true);
    this.fireMutationChange_(oldExtra);
  },
  minus: function() {
    if (this.itemCount_ <= this.minItems_) return;
    var oldExtra = this.mutationToDomText_();
    this.itemCount_--;
    this.updateShape_(false);
    this.fireMutationChange_(oldExtra);
  },
  addInput_: function(index, withShadow) {
    var input = this.appendValueInput(this.inputPrefix_ + index);
    if (this.inputCheck_) {
      input.setCheck(this.inputCheck_);
    }
    if (index === 1 && this.prefixLabel_) {
      input.appendField(this.prefixLabel_, 'PREFIXLABEL');
    } else if (index > 1 && this.separatorLabel_) {
      input.appendField(this.separatorLabel_, 'SEP' + index);
    }
    if (withShadow && this.shadowType_ && this.workspace && !this.isInsertionMarker()) {
      Blockly.ScratchBlocks.OperatorUtils.attachShadow_.call(this, input, this.shadowType_);
    }
    return input;
  },
  removeInput_: function(index) {
    var name = this.inputPrefix_ + index;
    var input = this.getInput(name);
    if (!input) return;
    if (input.connection) {
      var child = input.connection.targetBlock();
      if (child && !child.isShadow()) {
        input.connection.disconnect();
      }
      var remaining = input.connection.targetBlock();
      if (remaining && remaining.isShadow()) {
        remaining.dispose();
      }
    }
    this.removeInput(name);
  },
  updateShape_: function(addShadows) {
    var wasRendered = this.rendered;
    this.rendered = false;

    var existing = 0;
    while (this.getInput(this.inputPrefix_ + (existing + 1))) {
      existing++;
    }
    if (this.getInput('BUTTONS')) {
      this.removeInput('BUTTONS');
    }
    for (var i = existing + 1; i <= this.itemCount_; i++) {
      this.addInput_(i, addShadows);
    }
    for (var j = existing; j > this.itemCount_; j--) {
      this.removeInput_(j);
    }

    if (!Blockly.ScratchBlocks.OperatorUtils.arrowsHidden) {
      var buttons = this.appendDummyInput('BUTTONS');
      if (this.itemCount_ > this.minItems_) {
        buttons.appendField(
            Blockly.ScratchBlocks.OperatorUtils.makeButtonField('minus'), 'MINUS');
      }
      buttons.appendField(
          Blockly.ScratchBlocks.OperatorUtils.makeButtonField('plus'), 'PLUS');
    }

    this.setInputsInline(true);

    this.rendered = wasRendered;
    if (wasRendered && !this.isInsertionMarker()) {
      this.initSvg();
      this.render();
    }
  },
  customContextMenu: function(options) {
    if (this.isInFlyout) return;
    var block = this;
    options.push({
      enabled: true,
      text: Blockly.Msg.OPERATORS_ADD_INPUT || 'Add input',
      callback: function() {
        block.plus();
      }
    });
    if (this.itemCount_ > this.minItems_) {
      options.push({
        enabled: true,
        text: Blockly.Msg.OPERATORS_REMOVE_INPUT || 'Remove input',
        callback: function() {
          block.minus();
        }
      });
    }
  }
};

Blockly.ScratchBlocks.defineExtendableOperator = function(config) {
  var definition = {
    inputPrefix_: config.prefix,
    separatorLabel_: config.separator || '',
    prefixLabel_: config.prefixLabel || '',
    inputCheck_: config.check || null,
    shadowType_: config.shadow || null,
    minItems_: config.minItems || 2,
    init: function() {
      this.itemCount_ = this.minItems_;
      var extensions = [config.colour || "colours_operators"];
      if (config.output) extensions.push(config.output);
      this.jsonInit({
        "message0": "",
        "category": config.category || Blockly.Categories.operators,
        "extensions": extensions
      });
      if (config.output === null) {
        this.setOutput(true, null);
        this.setOutputShape(Blockly.OUTPUT_SHAPE_ROUND);
      }
      this.updateShape_();
    }
  };
  for (var key in Blockly.ScratchBlocks.OperatorUtils.MUTATOR_MIXIN) {
    definition[key] = Blockly.ScratchBlocks.OperatorUtils.MUTATOR_MIXIN[key];
  }
  return definition;
};

Blockly.Blocks['operator_add'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', separator: '+', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['operator_subtract'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', separator: '-', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['operator_multiply'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', separator: '*', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['operator_divide'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', separator: '/', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['operator_min'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', prefixLabel: Blockly.Msg.OPERATORS_MIN || 'min', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['operator_max'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', prefixLabel: Blockly.Msg.OPERATORS_MAX || 'max', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks['patching_jsreporter'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'ARG', prefixLabel: Blockly.Msg.OPERATORS_JS_LABEL || 'js', shadow: 'text', output: null,
  colour: 'colours_operators', category: 'Patching', minItems: 1
});

Blockly.Blocks['patching_jsboolean'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'ARG', prefixLabel: Blockly.Msg.OPERATORS_JS_LABEL || 'js', shadow: 'text', output: 'output_boolean',
  colour: 'colours_operators', category: 'Patching', minItems: 1
});

Blockly.Blocks['patching_jscommand'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'ARG', prefixLabel: Blockly.Msg.OPERATORS_JS_LABEL || 'js', shadow: 'text', output: 'shape_statement',
  colour: 'colours_operators', category: 'Patching', minItems: 1
});

Blockly.Blocks['operator_clamp'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_CLAMP,
      "args0": [
        {"type": "input_value", "name": "NUM"},
        {"type": "input_value", "name": "MIN"},
        {"type": "input_value", "name": "MAX"}
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

Blockly.Blocks['operator_random'] = {
  /**
   * Block for picking a random number.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_RANDOM,
      "args0": [
        {
          "type": "input_value",
          "name": "FROM"
        },
        {
          "type": "input_value",
          "name": "TO"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

Blockly.Blocks['operator_lt'] = {
  /**
   * Block for less than comparator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_LT,
      "args0": [
        {
          "type": "input_value",
          "name": "OPERAND1"
        },
        {
          "type": "input_value",
          "name": "OPERAND2"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_boolean"]
    });
  }
};

Blockly.Blocks['operator_equals'] = {
  /**
   * Block for equals comparator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_EQUALS,
      "args0": [
        {
          "type": "input_value",
          "name": "OPERAND1"
        },
        {
          "type": "input_value",
          "name": "OPERAND2"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_boolean"]
    });
  }
};

Blockly.Blocks['operator_gt'] = {
  /**
   * Block for greater than comparator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_GT,
      "args0": [
        {
          "type": "input_value",
          "name": "OPERAND1"
        },
        {
          "type": "input_value",
          "name": "OPERAND2"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_boolean"]
    });
  }
};

Blockly.Blocks['operator_and'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'OPERAND', separator: Blockly.Msg.OPERATORS_AND_SEPARATOR || 'and', check: 'Boolean', output: 'output_boolean'
});

Blockly.Blocks['operator_or'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'OPERAND', separator: Blockly.Msg.OPERATORS_OR_SEPARATOR || 'or', check: 'Boolean', output: 'output_boolean'
});

Blockly.Blocks['operator_not'] = {
  /**
   * Block for "not" unary boolean operator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_NOT,
      "args0": [
        {
          "type": "input_value",
          "name": "OPERAND",
          "check": "Boolean"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_boolean"]
    });
  }
};

Blockly.Blocks['operator_join'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'STRING', separator: '', prefixLabel: Blockly.Msg.OPERATORS_JOIN_LABEL || 'join',
  shadow: 'text', output: 'output_string', category: Blockly.Categories.operators,
  colour: 'colours_operators'
});

Blockly.Blocks['operator_letter_of'] = {
  /**
   * Block for "letter _ of _" operator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_LETTEROF,
      "args0": [
        {
          "type": "input_value",
          "name": "LETTER"
        },
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_length'] = {
  /**
   * Block for string length operator.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_LENGTH,
      "args0": [
        {
          "type": "input_value",
          "name": "STRING"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_contains'] = {
  /**
   * Block for _ contains _ operator
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_CONTAINS,
      "args0": [
        {
          "type": "input_value",
          "name": "STRING1"
        },
        {
          "type": "input_value",
          "name": "STRING2"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_boolean"]
    });
  }
};

Blockly.Blocks['operator_letters_of'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_LETTERSOF,
      "args0": [
        {"type": "input_value", "name": "LETTER1"},
        {"type": "input_value", "name": "LETTER2"},
        {"type": "input_value", "name": "STRING"}
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_index_of'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_INDEXOF,
      "args0": [
        {"type": "input_value", "name": "SUBSTRING"},
        {"type": "input_value", "name": "STRING"}
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

Blockly.Blocks['operator_replace'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_REPLACE,
      "args0": [
        {"type": "input_value", "name": "SUBSTRING"},
        {"type": "input_value", "name": "STRING"},
        {"type": "input_value", "name": "REPLACE"}
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_repeat'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_REPEAT,
      "args0": [
        {"type": "input_value", "name": "STRING"},
        {"type": "input_value", "name": "REPEAT"}
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_change_case'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_CHANGECASE,
      "args0": [
        {"type": "input_value", "name": "STRING"},
        {
          "type": "field_dropdown",
          "name": "CASE",
          "options": [
            [Blockly.Msg.OPERATORS_LOWERCASE, 'lowercase'],
            [Blockly.Msg.OPERATORS_UPPERCASE, 'uppercase']
          ]
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_trim'] = {
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_TRIM,
      "args0": [{"type": "input_value", "name": "STRING"}],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_mod'] = Blockly.ScratchBlocks.defineExtendableOperator({
  prefix: 'NUM', separator: Blockly.Msg.OPERATORS_MOD_SEPARATOR || 'mod', shadow: 'math_number', output: 'output_number'
});

Blockly.Blocks["operator_pi"] = {
  /**
   * Block for pi constant.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_PI,
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

Blockly.Blocks["operator_newline"] = {
  /**
   * Block for newline character.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_NEWLINE,
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_string"]
    });
  }
};

Blockly.Blocks['operator_round'] = {
  /**
   * Block for rounding a numbers.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_ROUND,
      "args0": [
        {
          "type": "input_value",
          "name": "NUM"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};

Blockly.Blocks['operator_mathop'] = {
  /**
   * Block for "advanced" math ops on a number.
   * @this Blockly.Block
   */
  init: function() {
    this.jsonInit({
      "message0": Blockly.Msg.OPERATORS_MATHOP,
      "args0": [
        {
          "type": "field_dropdown",
          "name": "OPERATOR",
          "options": [
            [Blockly.Msg.OPERATORS_MATHOP_ABS, 'abs'],
            [Blockly.Msg.OPERATORS_MATHOP_FLOOR, 'floor'],
            [Blockly.Msg.OPERATORS_MATHOP_CEILING, 'ceiling'],
            [Blockly.Msg.OPERATORS_MATHOP_SQRT, 'sqrt'],
            [Blockly.Msg.OPERATORS_MATHOP_SIN, 'sin'],
            [Blockly.Msg.OPERATORS_MATHOP_COS, 'cos'],
            [Blockly.Msg.OPERATORS_MATHOP_TAN, 'tan'],
            [Blockly.Msg.OPERATORS_MATHOP_ASIN, 'asin'],
            [Blockly.Msg.OPERATORS_MATHOP_ACOS, 'acos'],
            [Blockly.Msg.OPERATORS_MATHOP_ATAN, 'atan'],
            [Blockly.Msg.OPERATORS_MATHOP_LN, 'ln'],
            [Blockly.Msg.OPERATORS_MATHOP_LOG, 'log'],
            [Blockly.Msg.OPERATORS_MATHOP_EEXP, 'e ^'],
            [Blockly.Msg.OPERATORS_MATHOP_10EXP, '10 ^']
          ]
        },
        {
          "type": "input_value",
          "name": "NUM"
        }
      ],
      "category": Blockly.Categories.operators,
      "extensions": ["colours_operators", "output_number"]
    });
  }
};
