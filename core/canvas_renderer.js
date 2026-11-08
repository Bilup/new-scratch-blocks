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
 * @fileoverview Paints block backgrounds with a canvas layer instead of
 * individual SVG paths.  The SVG paths stay in the DOM (with transparent
 * paint) so that hit testing, dragging, tooltips and layout are unchanged.
 */
'use strict';

goog.provide('Blockly.CanvasRenderer');

goog.require('Blockly.utils');
goog.require('goog.dom');
goog.require('goog.math.Coordinate');

/**
 * Whether block backgrounds are painted with canvas.  Off by default; can be
 * turned on globally or per workspace with the `canvasRenderer` inject option.
 * @type {boolean}
 */
Blockly.CANVAS_RENDERER_ENABLED = false;

/**
 * Whether blocks outside the viewport have their SVG subtrees detached from
 * the DOM.  Offscreen blocks still exist as Blockly objects, but they no
 * longer contribute layout and compositing work.
 * @type {boolean}
 */
Blockly.CANVAS_RENDERER_DOM_CULLING_ENABLED = true;

/**
 * Number of distinct path definitions to cache as Path2D objects.
 * @const
 */
Blockly.CANVAS_RENDERER_MAX_PATH_CACHE = 4096;

/**
 * Canvas-based painter for the visible blocks of a workspace.
 * @param {!Blockly.WorkspaceSvg} workspace The workspace to paint.
 * @constructor
 */
Blockly.CanvasRenderer = function(workspace) {
  /**
   * @type {!Blockly.WorkspaceSvg}
   * @private
   */
  this.workspace_ = workspace;

  /**
   * @type {boolean}
   * @private
   */
  this.disposed_ = false;

  /**
   * @type {boolean}
   * @private
   */
  this.dirty_ = false;

  /**
   * @type {?number}
   * @private
   */
  this.frameHandle_ = null;

  /**
   * Cache of parsed path data, keyed by the path's `d` attribute.
   * @type {!Object<string, !Path2D>}
   * @private
   */
  this.pathCache_ = Object.create(null);

  /**
   * @type {!Array<string>}
   * @private
   */
  this.pathCacheKeys_ = [];

  /**
   * Blocks whose SVG paint is temporarily restored (e.g. glowing blocks).
   * @type {!Object<string, boolean>}
   * @private
   */
  this.paintOverrides_ = Object.create(null);

  /**
   * DOM state of blocks whose SVG subtree is currently outside the normal
   * hierarchy, keyed by block id.  Each entry records the parent the subtree
   * must return to, plus the transform it had before being promoted to the
   * workspace canvas.
   * @type {!Object<string, {parent: ?Node, nextSibling: ?Node,
   *     transform: ?string, promoted: boolean}>}
   * @private
   */
  this.detachedBlocks_ = Object.create(null);

  /**
   * Blocks promoted to the canvas during the current culling pass.  They must
   * not be restored while their former ancestors are being detached.
   * @type {?Object<string, boolean>}
   * @private
   */
  this.activelyPromoted_ = null;

  /**
   * Key of the viewport the current culling decision was made for.
   * @type {?string}
   * @private
   */
  this.lastCullKey_ = null;

  /**
   * Whether culling must be recomputed on the next paint.
   * @type {boolean}
   * @private
   */
  this.forceCull_ = false;

  /**
   * Subtree bounding boxes in coordinates relative to each block's own origin,
   * keyed by block id.  Cleared whenever block geometry may have changed, so
   * viewport-only changes can prune whole subtrees in constant time.
   * @type {!Object<string, {left: number, top: number, right: number,
   *     bottom: number}>}
   * @private
   */
  this.subtreeBoxes_ = Object.create(null);

  /**
   * Ids of blocks currently promoted to the workspace canvas.
   * @type {!Object<string, boolean>}
   * @private
   */
  this.promotedBlocks_ = Object.create(null);

  /**
   * Position of each top-level block in the workspace's top-block list, keyed
   * by block id.  Scripts and their promoted descendants are inserted at this
   * canonical stacking position.
   * @type {!Object<string, number>}
   * @private
   */
  this.scriptIndexes_ = Object.create(null);

  /**
   * Monotonic counter that orders promotions, so promoted blocks keep a
   * stable stacking order across culling passes.
   * @type {number}
   * @private
   */
  this.promotionOrder_ = 0;

  this.createDom_();
};

/**
 * Create the canvas layer inside the workspace's SVG group, directly above the
 * background and below the blocks so that fields and icons stay on top.
 * @private
 */
Blockly.CanvasRenderer.prototype.createDom_ = function() {
  var workspace = this.workspace_;
  this.foreignObject_ = Blockly.utils.createSvgElement('foreignObject',
      {'class': 'blocklyCanvasLayer', 'width': '100%', 'height': '100%'},
      null);
  this.foreignObject_.style.pointerEvents = 'none';
  this.canvas_ = document.createElement('canvas');
  this.canvas_.style.width = '100%';
  this.canvas_.style.height = '100%';
  this.canvas_.style.display = 'block';
  this.foreignObject_.appendChild(this.canvas_);

  var group = workspace.svgGroup_;
  var background = workspace.svgBackground_;
  if (background && background.parentNode === group) {
    group.insertBefore(this.foreignObject_, background.nextSibling);
  } else {
    group.insertBefore(this.foreignObject_, group.firstChild);
  }
  // The CSS for this class makes the SVG block paths transparent, so that
  // only the canvas paints block backgrounds.
  Blockly.utils.addClass(group, 'blocklyCanvasMode');
  this.ctx_ = this.canvas_.getContext ? this.canvas_.getContext('2d') : null;
  this.dpr_ = 0;
  this.viewWidth_ = 0;
  this.viewHeight_ = 0;
};

/**
 * Schedule a repaint on the next animation frame.
 */
Blockly.CanvasRenderer.prototype.requestRender = function(forceCull) {
  if (this.disposed_) {
    return;
  }
  this.dirty_ = true;
  if (forceCull) {
    this.forceCull_ = true;
  }
  if (this.frameHandle_ !== null) {
    return;
  }
  var self = this;
  this.frameHandle_ = window.requestAnimationFrame(function() {
    self.frameHandle_ = null;
    self.render_();
  });
};

/**
 * Immediately repaint, if anything is pending.
 */
Blockly.CanvasRenderer.prototype.renderIfDirty = function() {
  if (this.dirty_) {
    this.render_();
  }
};

/**
 * Restore or hide the SVG paint of a single block.  Glowing blocks keep their
 * SVG rendering so that filters continue to work.
 * @param {!Blockly.BlockSvg} block The block to update.
 * @param {boolean} overridePaint True to let SVG paint the block.
 */
Blockly.CanvasRenderer.prototype.setBlockPaintOverride = function(block,
    overridePaint) {
  if (this.disposed_ || !block || !block.svgPath_) {
    return;
  }
  var paths = [block.svgPath_];
  for (var i = 0, input; input = block.inputList[i]; i++) {
    if (input.outlinePath) {
      paths.push(input.outlinePath);
    }
  }
  for (var j = 0; j < paths.length; j++) {
    var path = paths[j];
    if (overridePaint) {
      path.style.fill = path.getAttribute('fill') || '';
      path.style.stroke = path.getAttribute('stroke') || '';
    } else {
      path.style.fill = '';
      path.style.stroke = '';
    }
  }
  if (overridePaint) {
    this.paintOverrides_[block.id] = true;
  } else {
    delete this.paintOverrides_[block.id];
  }
  this.requestRender();
};

/**
 * Repaint the canvas layer.
 * @private
 */
Blockly.CanvasRenderer.prototype.render_ = function() {
  this.dirty_ = false;
  var workspace = this.workspace_;
  if (this.disposed_ || !workspace || !workspace.rendered || !this.ctx_) {
    return;
  }
  // While the workspace is being panned, the blocks live on the drag surface
  // and are painted by SVG.
  if (workspace.useWorkspaceDragSurface_ && workspace.isDragSurfaceActive_) {
    this.clear_();
    return;
  }
  var svg = workspace.getParentSvg();
  if (!svg) {
    return;
  }
  var rect = svg.getBoundingClientRect();
  var width = Math.max(0, Math.round(rect.width));
  var height = Math.max(0, Math.round(rect.height));
  if (!width || !height) {
    this.clear_();
    return;
  }
  var dpr = window.devicePixelRatio || 1;
  var backingWidth = Math.round(width * dpr);
  var backingHeight = Math.round(height * dpr);
  if (this.canvas_.width !== backingWidth ||
      this.canvas_.height !== backingHeight) {
    this.canvas_.width = backingWidth;
    this.canvas_.height = backingHeight;
    this.dpr_ = dpr;
    this.viewWidth_ = width;
    this.viewHeight_ = height;
  }

  var ctx = this.ctx_;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, backingWidth, backingHeight);
  if (this.viewWidth_ !== width || this.viewHeight_ !== height) {
    this.viewWidth_ = width;
    this.viewHeight_ = height;
  }

  var view = this.computeView_(width, height);
  if (this.forceCull_) {
    this.lastCullKey_ = null;
    this.forceCull_ = false;
    // Block geometry may have changed; rebuild subtree bounds lazily.
    this.subtreeBoxes_ = Object.create(null);
  }
  this.updateCulling_(view);
  var children = workspace.getCanvas().children;
  for (var i = 0; i < children.length; i++) {
    var element = children[i];
    var id = element.getAttribute('data-id');
    if (!id) {
      continue;
    }
    var block = workspace.getBlockById(id);
    if (!block || !block.svgGroup_) {
      continue;
    }
    var xy = Blockly.utils.getRelativeXY(element);
    this.renderBlock_(block, xy.x, xy.y, view);
  }
};

/**
 * Detach the SVG subtrees of blocks that are outside the viewport, and
 * reattach those that come back into view.
 *
 * Culling works on whole subtrees rather than only on top-level blocks.  A
 * giant script is a single top-level block, so when the viewport shows its
 * middle or its tail the blocks above the viewport would normally stay in the
 * DOM.  Those invisible ancestors are handled by "promoting" the first visible
 * block of each branch: it is moved directly onto the workspace canvas with an
 * absolute transform, which lets every invisible ancestor leave the DOM while
 * the visible frontier keeps its SVG node (and therefore its hit testing).
 *
 * @param {!Object} view Visible region from computeView_.
 * @private
 */
Blockly.CanvasRenderer.prototype.updateCulling_ = function(view) {
  if (!Blockly.CANVAS_RENDERER_DOM_CULLING_ENABLED) {
    return;
  }
  var workspace = this.workspace_;
  if (workspace.isFlyout || workspace.isDragging()) {
    return;
  }
  var key = [view.left, view.top, view.right, view.bottom].join(',');
  if (key === this.lastCullKey_) {
    return;
  }
  this.lastCullKey_ = key;

  var bounds = {
    left: view.left,
    top: view.top,
    right: view.right,
    bottom: view.bottom
  };
  this.activelyPromoted_ = Object.create(null);
  var topBlocks = workspace.getTopBlocks(false);
  this.updateScriptIndexes_(topBlocks);
  for (var i = 0; i < topBlocks.length; i++) {
    var block = topBlocks[i];
    if (!block.rendered || !block.svgGroup_) {
      continue;
    }
    if (Blockly.utils.hasClass(block.svgGroup_, 'blocklyDragging') ||
        block.isInFlyout) {
      continue;
    }
    var xy = block.getRelativeToSurfaceXY();
    if (this.subtreeOutside_(block, xy.x, xy.y, bounds)) {
      this.ensureDetached_(block);
      continue;
    }
    this.updateTree_(block, xy.x, xy.y, bounds);
  }
  if (this.promotionOrder_) {
    this.reorderPromoted_();
  }
  this.activelyPromoted_ = null;
};

/**
 * Reconcile the DOM of one logical block tree with the viewport.
 * @param {!Blockly.BlockSvg} block Root of the tree.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @private
 */
Blockly.CanvasRenderer.prototype.updateTree_ = function(block, x, y, bounds) {
  if (!this.isInside_(block, x, y, bounds)) {
    if (this.subtreeOutside_(block, x, y, bounds)) {
      this.ensureDetached_(block);
      return;
    }
    var frontier = this.cutAt_(block, x, y, bounds);
    for (var i = 0; i < frontier.length; i++) {
      this.updateVisibleTree_(frontier[i].block, frontier[i].x, frontier[i].y,
          bounds);
    }
    return;
  }
  this.ensureAttached_(block);
  this.updateVisibleTree_(block, x, y, bounds);
};

/**
 * Reconcile the children of a block that is itself in the DOM.
 * @param {!Blockly.BlockSvg} root Visible block whose SVG is in the DOM.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @private
 */
Blockly.CanvasRenderer.prototype.updateVisibleTree_ = function(root, x, y,
    bounds) {
  var stack = [{block: root, x: x, y: y}];
  while (stack.length) {
    var item = stack.pop();
    var children = item.block.getChildren();
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child.rendered || !child.svgGroup_) {
        continue;
      }
      var pos = this.childPosition_(item.x, item.y, child);
      if (this.isInside_(child, pos.x, pos.y, bounds)) {
        this.ensureAttached_(child);
        stack.push({block: child, x: pos.x, y: pos.y});
      } else if (this.subtreeOutside_(child, pos.x, pos.y, bounds)) {
        this.ensureDetached_(child);
      } else {
        var frontier = this.cutAt_(child, pos.x, pos.y, bounds);
        for (var j = 0; j < frontier.length; j++) {
          stack.push(frontier[j]);
        }
      }
    }
  }
};

/**
 * Cut a subtree off the DOM: promote its visible frontier blocks to the
 * workspace canvas, then remove the (now entirely invisible) subtree root.
 * @param {!Blockly.BlockSvg} block Subtree root to detach.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @return {!Array<!Object>} Promoted blocks, with their absolute coordinates.
 * @private
 */
Blockly.CanvasRenderer.prototype.cutAt_ = function(block, x, y, bounds) {
  var frontier = [];
  this.collectFrontier_(block, x, y, bounds, frontier);
  for (var i = 0; i < frontier.length; i++) {
    this.ensurePromoted_(frontier[i].block, frontier[i].x, frontier[i].y);
  }
  this.ensureDetached_(block);
  return frontier;
};

/**
 * Collect the blocks that are themselves visible but whose ancestors are not.
 * @param {!Blockly.BlockSvg} block Subtree root.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @param {!Array<!Object>} out Receives {block, x, y} entries.
 * @private
 */
Blockly.CanvasRenderer.prototype.collectFrontier_ = function(block, x, y,
    bounds, out) {
  var stack = [{block: block, x: x, y: y}];
  while (stack.length) {
    var item = stack.pop();
    if (this.isInside_(item.block, item.x, item.y, bounds)) {
      out.push(item);
      continue;
    }
    var children = item.block.getChildren();
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (!child.rendered || !child.svgGroup_) {
        continue;
      }
      var pos = this.childPosition_(item.x, item.y, child);
      // A branch whose whole subtree is offscreen cannot contain a frontier
      // block; skip it in constant time.
      if (this.subtreeOutside_(child, pos.x, pos.y, bounds)) {
        continue;
      }
      stack.push({block: child, x: pos.x, y: pos.y});
    }
  }
};

/**
 * Whether a whole logical tree lies entirely outside the visible region.
 * Uses cached subtree bounds, so pruning is constant time once the geometry
 * of the viewport's trees has been measured.
 * @param {!Blockly.BlockSvg} block Root of the tree.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @return {boolean} True if the tree cannot intersect the viewport.
 * @private
 */
Blockly.CanvasRenderer.prototype.subtreeOutside_ = function(block, x, y,
    bounds) {
  var box = this.getSubtreeBox_(block);
  if (!box) {
    return false;
  }
  var margin = 24;
  return x + box.right < bounds.left - margin ||
      x + box.left > bounds.right + margin ||
      y + box.bottom < bounds.top - margin ||
      y + box.top > bounds.bottom + margin;
};

/**
 * Retrieve the bounding box of a subtree, relative to the root block's origin.
 * Recomputes and caches it on demand.
 * @param {!Blockly.BlockSvg} block Root of the tree.
 * @return {?{left: number, top: number, right: number, bottom: number}}
 * @private
 */
Blockly.CanvasRenderer.prototype.getSubtreeBox_ = function(block) {
  var cached = this.subtreeBoxes_[block.id];
  if (cached) {
    return cached;
  }
  this.computeSubtreeBox_(block);
  return this.subtreeBoxes_[block.id] || null;
};

/**
 * Compute subtree bounding boxes bottom-up for a root and its descendants.
 * The result is stored relative to each block's own origin.
 * @param {!Blockly.BlockSvg} root Root of the tree.
 * @private
 */
Blockly.CanvasRenderer.prototype.computeSubtreeBox_ = function(root) {
  var stack = [{block: root, visited: false}];
  while (stack.length) {
    var item = stack.pop();
    var block = item.block;
    if (!item.visited) {
      stack.push({block: block, visited: true});
      var children = block.getChildren();
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (!child.rendered || !child.svgGroup_ ||
            this.subtreeBoxes_[child.id]) {
          continue;
        }
        stack.push({block: child, visited: false});
      }
      continue;
    }
    var left = 0;
    var top = 0;
    var right = Math.max(block.width || 0, 24);
    var bottom = Math.max(block.height || 0, 24);
    var kids = block.getChildren();
    for (var j = 0; j < kids.length; j++) {
      var kid = kids[j];
      var kidBox = kid.svgGroup_ ? this.subtreeBoxes_[kid.id] : null;
      if (!kidBox) {
        continue;
      }
      var rel = this.relativeChildPosition_(kid);
      if (rel.x + kidBox.left < left) {
        left = rel.x + kidBox.left;
      }
      if (rel.y + kidBox.top < top) {
        top = rel.y + kidBox.top;
      }
      if (rel.x + kidBox.right > right) {
        right = rel.x + kidBox.right;
      }
      if (rel.y + kidBox.bottom > bottom) {
        bottom = rel.y + kidBox.bottom;
      }
    }
    this.subtreeBoxes_[block.id] = {
      left: left,
      top: top,
      right: right,
      bottom: bottom
    };
  }
};

/**
 * Position of a child relative to its parent group, independent of whether it
 * is currently promoted to the canvas.
 * @param {!Blockly.BlockSvg} child The child block.
 * @return {{x: number, y: number}} Relative coordinates.
 * @private
 */
Blockly.CanvasRenderer.prototype.relativeChildPosition_ = function(child) {
  var record = this.detachedBlocks_[child.id];
  if (record && record.promoted) {
    var transform = record.transform;
    if (!transform) {
      return {x: 0, y: 0};
    }
    var match = transform.match(
        /translate\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)\s*\)/);
    if (match) {
      return {x: parseFloat(match[1]), y: parseFloat(match[2])};
    }
    return {x: 0, y: 0};
  }
  return Blockly.utils.getRelativeXY(child.svgGroup_);
};

/**
 * Record the position of each top-level block in the workspace's top-block
 * list.  This list order is the canonical stacking order of the scripts.
 * @param {!Array<!Blockly.BlockSvg>} topBlocks Top-level blocks.
 * @private
 */
Blockly.CanvasRenderer.prototype.updateScriptIndexes_ = function(topBlocks) {
  this.scriptIndexes_ = Object.create(null);
  for (var i = 0; i < topBlocks.length; i++) {
    this.scriptIndexes_[topBlocks[i].id] = i;
  }
};

/**
 * Canvas child that a script's nodes must be inserted in front of, i.e. the
 * first node belonging to a script that comes later in the top-block list.
 * @param {string} topId Id of the top-level block.
 * @param {!Element} canvas The workspace canvas group.
 * @return {?Node} Anchor node, or null to append at the end.
 * @private
 */
Blockly.CanvasRenderer.prototype.findAnchorForScript_ = function(topId,
    canvas) {
  var index = this.scriptIndexes_[topId];
  if (index === undefined) {
    return null;
  }
  var children = canvas.children;
  for (var i = 0; i < children.length; i++) {
    var childIndex = this.scriptIndexOfChild_(children[i]);
    if (childIndex > index) {
      return children[i];
    }
  }
  return null;
};

/**
 * Which script a direct canvas child belongs to.
 * @param {!Node} child A direct child of the canvas group.
 * @return {number} Top-block index, or -1 when the node is not a block.
 * @private
 */
Blockly.CanvasRenderer.prototype.scriptIndexOfChild_ = function(child) {
  if (!child.getAttribute) {
    return -1;
  }
  var id = child.getAttribute('data-id');
  if (!id) {
    return -1;
  }
  var index = this.scriptIndexes_[id];
  if (index !== undefined) {
    return index;
  }
  var record = this.detachedBlocks_[id];
  if (record && record.promoted && record.topId) {
    var recordIndex = this.scriptIndexes_[record.topId];
    if (recordIndex !== undefined) {
      return recordIndex;
    }
  }
  return -1;
};

/**
 * Absolute position of a child block, accounting for promoted blocks whose
 * transform is already absolute rather than relative to their parent group.
 * @param {number} parentX Absolute workspace x of the parent.
 * @param {number} parentY Absolute workspace y of the parent.
 * @param {!Blockly.BlockSvg} child The child block.
 * @return {{x: number, y: number}} Absolute workspace coordinates.
 * @private
 */
Blockly.CanvasRenderer.prototype.childPosition_ = function(parentX, parentY,
    child) {
  var group = child.svgGroup_;
  var xy = Blockly.utils.getRelativeXY(group);
  var record = this.detachedBlocks_[child.id];
  if (record && record.promoted && this.workspace_ &&
      group.parentNode === this.workspace_.getCanvas()) {
    return {x: xy.x, y: xy.y};
  }
  return {x: parentX + xy.x, y: parentY + xy.y};
};

/**
 * Whether a block's own paint intersects the visible region.
 * @param {!Blockly.BlockSvg} block The block to test.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} bounds Visible region in workspace units.
 * @return {boolean} True if the block's own box is visible.
 * @private
 */
Blockly.CanvasRenderer.prototype.isInside_ = function(block, x, y, bounds) {
  var width = Math.max(block.width || 0, 24);
  var height = Math.max(block.height || 0, 24);
  return !(x + width < bounds.left || x > bounds.right ||
      y + height < bounds.top || y > bounds.bottom);
};

/**
 * Move a block out of its (invisible) ancestors and onto the workspace canvas,
 * using an absolute transform.
 * @param {!Blockly.BlockSvg} block The block to promote.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @private
 */
Blockly.CanvasRenderer.prototype.ensurePromoted_ = function(block, x, y) {
  var canvas = this.workspace_.getCanvas();
  var group = block.svgGroup_;
  if (!group) {
    return;
  }
  var record = this.detachedBlocks_[block.id];
  if (record && record.promoted) {
    if (group.parentNode === canvas) {
      this.setAbsoluteTransform_(group, x, y);
      this.promotedBlocks_[block.id] = true;
      if (this.activelyPromoted_) {
        this.activelyPromoted_[block.id] = true;
      }
      return;
    }
    // Something else moved the block; drop the stale record.
    this.dropRecord_(block.id);
    record = null;
  }
  if (!record) {
    if (!group.parentNode) {
      return;
    }
    record = {
      parent: group.parentNode,
      nextSibling: group.nextSibling,
      transform: group.getAttribute('transform'),
      promoted: false,
      topId: null,
      order: 0,
      anchor: null
    };
  }
  if (record.transform === undefined) {
    record.transform = null;
  }
  var anchor = this.getPromotionAnchor_(block, canvas, record);
  record.anchor = anchor;
  this.detachedBlocks_[block.id] = record;
  record.promoted = true;
  record.order = ++this.promotionOrder_;
  this.promotedBlocks_[block.id] = true;
  if (group.parentNode) {
    group.parentNode.removeChild(group);
  }
  if (anchor) {
    canvas.insertBefore(group, anchor);
  } else {
    canvas.appendChild(group);
  }
  this.setAbsoluteTransform_(group, x, y);
  if (this.activelyPromoted_) {
    this.activelyPromoted_[block.id] = true;
  }
};

/**
 * Canvas node that promoted blocks should be inserted in front of, keeping
 * them close to their original script's stacking position.
 * @param {!Blockly.BlockSvg} block The block being promoted.
 * @param {!Element} canvas The workspace canvas group.
 * @return {?Node} Anchor node, or null to append at the end.
 * @private
 */
Blockly.CanvasRenderer.prototype.getPromotionAnchor_ = function(block, canvas,
    record) {
  var top = block;
  while (top.getParent && top.getParent()) {
    top = top.getParent();
  }
  if (!top.svgGroup_) {
    return null;
  }
  record.topId = top.id;
  return this.findAnchorForScript_(top.id, canvas);
};

/**
 * Restore the stacking order of promoted blocks so that within each script the
 * later promotions (deeper in the logical tree) paint on top.
 * @private
 */
Blockly.CanvasRenderer.prototype.reorderPromoted_ = function() {
  var canvas = this.workspace_.getCanvas();
  var groups = Object.create(null);
  var ids = Object.keys(this.promotedBlocks_);
  for (var i = 0; i < ids.length; i++) {
    var record = this.detachedBlocks_[ids[i]];
    if (!record || !record.promoted) {
      continue;
    }
    var topId = record.topId || '';
    if (!groups[topId]) {
      groups[topId] = [];
    }
    groups[topId].push(ids[i]);
  }
  var renderer = this;
  for (var topId in groups) {
    var anchor = this.findAnchorForScript_(topId, canvas);
    var list = groups[topId];
    list.sort(function(a, b) {
      var recordA = renderer.detachedBlocks_[a];
      var recordB = renderer.detachedBlocks_[b];
      return (recordA.order || 0) - (recordB.order || 0);
    });
    for (var k = 0; k < list.length; k++) {
      var block = this.workspace_.getBlockById(list[k]);
      if (!block || !block.svgGroup_ ||
          block.svgGroup_.parentNode !== canvas) {
        continue;
      }
      if (anchor) {
        canvas.insertBefore(block.svgGroup_, anchor);
      } else {
        canvas.appendChild(block.svgGroup_);
      }
    }
  }
};

/**
 * Forget the DOM record for a block.
 * @param {string} id Block id.
 * @private
 */
Blockly.CanvasRenderer.prototype.dropRecord_ = function(id) {
  delete this.detachedBlocks_[id];
  delete this.promotedBlocks_[id];
};

/**
 * Put a block back into its normal DOM hierarchy, restoring its relative
 * transform if it had been promoted.
 * @param {!Blockly.BlockSvg} block The block to attach.
 * @private
 */
Blockly.CanvasRenderer.prototype.ensureAttached_ = function(block) {
  var record = this.detachedBlocks_[block.id];
  if (!record) {
    return;
  }
  var group = block.svgGroup_;
  if (!group) {
    this.dropRecord_(block.id);
    return;
  }
  if (record.promoted) {
    if (group.parentNode !== this.workspace_.getCanvas()) {
      this.dropRecord_(block.id);
      return;
    }
  } else if (group.parentNode) {
    this.dropRecord_(block.id);
    return;
  }
  var parent = record.parent;
  var logicalParent = this.getLogicalParentGroup_(block);
  if (record.promoted && logicalParent === this.workspace_.getCanvas()) {
    // The block was brought back to the top level while promoted, so its
    // absolute transform is authoritative and the saved one is stale.
    this.dropRecord_(block.id);
    return;
  }
  if (!parent || parent !== logicalParent) {
    parent = logicalParent;
  }
  if (!parent) {
    this.dropRecord_(block.id);
    return;
  }
  if (record.promoted) {
    if (record.transform) {
      group.setAttribute('transform', record.transform);
    } else {
      group.removeAttribute('transform');
    }
  }
  var canvas = this.workspace_.getCanvas();
  var nextSibling = record.nextSibling;
  if (parent === canvas && this.scriptIndexes_[block.id] !== undefined) {
    // Top-level blocks are placed by their canonical script order so that
    // promoted descendants and neighbouring scripts keep their z-order.
    var scriptAnchor = this.findAnchorForScript_(block.id, canvas);
    if (scriptAnchor) {
      canvas.insertBefore(group, scriptAnchor);
    } else {
      canvas.appendChild(group);
    }
  } else if (nextSibling && nextSibling.parentNode === parent) {
    parent.insertBefore(group, nextSibling);
  } else {
    parent.appendChild(group);
  }
  this.dropRecord_(block.id);
};

/**
 * Keep a block's SVG subtree out of the DOM.  Promoted descendants are folded
 * back into the subtree first so that they leave the DOM together with it.
 * @param {!Blockly.BlockSvg} block The block to detach.
 * @private
 */
Blockly.CanvasRenderer.prototype.ensureDetached_ = function(block) {
  var group = block.svgGroup_;
  if (!group) {
    return;
  }
  this.restorePromotedWithin_(block);
  var record = this.detachedBlocks_[block.id];
  var canvas = this.workspace_.getCanvas();
  if (record && record.promoted &&
      this.getLogicalParentGroup_(block) === canvas) {
    // The block was dragged loose while promoted; treat it as top-level.
    this.dropRecord_(block.id);
    record = null;
  }
  if (record && record.promoted) {
    if (group.parentNode !== canvas) {
      this.dropRecord_(block.id);
      return;
    }
    canvas.removeChild(group);
    if (record.transform) {
      group.setAttribute('transform', record.transform);
    } else {
      group.removeAttribute('transform');
    }
    record.promoted = false;
    delete this.promotedBlocks_[block.id];
    return;
  }
  if (!group.parentNode) {
    return;
  }
  this.detachedBlocks_[block.id] = {
    parent: group.parentNode,
    nextSibling: group.nextSibling,
    transform: null,
    promoted: false
  };
  group.parentNode.removeChild(group);
};

/**
 * Move promoted blocks that logically belong inside a subtree back into it.
 * Used when the subtree leaves the DOM, and when it starts being dragged.
 * @param {!Blockly.BlockSvg} root Subtree root.
 * @private
 */
Blockly.CanvasRenderer.prototype.restorePromotedWithin_ = function(root) {
  var group = root.svgGroup_;
  if (!group) {
    return;
  }
  var ids = [];
  var promotedIds = Object.keys(this.promotedBlocks_);
  for (var p = 0; p < promotedIds.length; p++) {
    var id = promotedIds[p];
    if (!this.detachedBlocks_[id]) {
      delete this.promotedBlocks_[id];
      continue;
    }
    if (this.activelyPromoted_ && this.activelyPromoted_[id]) {
      continue;
    }
    ids.push(id);
  }
  for (var i = 0; i < ids.length; i++) {
    var record = this.detachedBlocks_[ids[i]];
    if (!record || !record.promoted) {
      continue;
    }
    var block = this.workspace_.getBlockById(ids[i]);
    if (!block) {
      this.dropRecord_(ids[i]);
      continue;
    }
    // Use the logical tree, not the DOM: nested detachments can leave DOM
    // gaps inside a subtree that is being removed.
    if (this.isLogicalInSubtree_(block, root)) {
      this.ensureAttached_(block);
    }
  }
};

/**
 * Whether a block is a logical descendant of another block (or the block
 * itself), following parent links rather than the DOM.
 * @param {!Blockly.BlockSvg} block Block to test.
 * @param {!Blockly.BlockSvg} root Ancestor block.
 * @return {boolean} True if block belongs to root's logical subtree.
 * @private
 */
Blockly.CanvasRenderer.prototype.isLogicalInSubtree_ = function(block, root) {
  var node = block;
  while (node) {
    if (node === root) {
      return true;
    }
    node = node.getParent ? node.getParent() : null;
  }
  return false;
};

/**
 * The DOM group a block belongs in when it is not promoted.
 * @param {!Blockly.BlockSvg} block The block to look up.
 * @return {?Node} Parent block group, or the workspace canvas.
 * @private
 */
Blockly.CanvasRenderer.prototype.getLogicalParentGroup_ = function(block) {
  var parent = block.getParent ? block.getParent() : null;
  if (parent && parent.svgGroup_) {
    return parent.svgGroup_;
  }
  return this.workspace_ ? this.workspace_.getCanvas() : null;
};

/**
 * Set a block's transform to its absolute position on the workspace.
 * @param {!Element} group The block's SVG group.
 * @param {number} x Absolute workspace x.
 * @param {number} y Absolute workspace y.
 * @private
 */
Blockly.CanvasRenderer.prototype.setAbsoluteTransform_ = function(group, x, y) {
  var transform = 'translate(' + x + ',' + y + ')';
  if (group.getAttribute('transform') !== transform) {
    group.setAttribute('transform', transform);
  }
};

/**
 * Stop tracking a block, e.g. when it is disposed.
 * @param {!Blockly.BlockSvg} block The block that went away.
 */
Blockly.CanvasRenderer.prototype.forgetBlock = function(block) {
  this.dropRecord_(block.id);
  delete this.paintOverrides_[block.id];
  delete this.subtreeBoxes_[block.id];
  delete this.scriptIndexes_[block.id];
  if (this.activelyPromoted_) {
    delete this.activelyPromoted_[block.id];
  }
};

/**
 * Compute the visible region of the workspace, in workspace coordinates.
 * @param {number} width Visible width in CSS pixels.
 * @param {number} height Visible height in CSS pixels.
 * @return {{left:number, top:number, right:number, bottom:number, scale:number,
 *     tx:number, ty:number}}
 * @private
 */
Blockly.CanvasRenderer.prototype.computeView_ = function(width, height) {
  var workspace = this.workspace_;
  var tx = workspace.scrollX;
  var ty = workspace.scrollY;
  var scale = workspace.scale;
  var transform = workspace.getCanvas().getAttribute('transform');
  if (transform) {
    var translateMatch = transform.match(
        /translate\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)\s*\)/);
    if (translateMatch) {
      tx = parseFloat(translateMatch[1]);
      ty = parseFloat(translateMatch[2]);
    }
    var scaleMatch = transform.match(/scale\(\s*([-\d.eE+]+)\s*\)/);
    if (scaleMatch) {
      scale = parseFloat(scaleMatch[1]);
    }
  }
  if (!scale) {
    scale = 1;
  }
  return {
    left: -tx / scale,
    top: -ty / scale,
    right: (width - tx) / scale,
    bottom: (height - ty) / scale,
    scale: scale,
    tx: tx,
    ty: ty
  };
};

/**
 * Paint a block and its descendants, skipping anything outside the viewport.
 * @param {!Blockly.BlockSvg} block The block to paint.
 * @param {number} x Absolute workspace x of the block.
 * @param {number} y Absolute workspace y of the block.
 * @param {!Object} view Visible region from computeView_.
 * @private
 */
Blockly.CanvasRenderer.prototype.renderBlock_ = function(block, x, y, view) {
  if (!block.rendered || !block.svgGroup_) {
    return;
  }
  if (block.intersects_ === false ||
      block.svgGroup_.style.display === 'none') {
    return;
  }
  if (this.paintOverrides_[block.id]) {
    // This block is painted by SVG on purpose.
    return;
  }
  var width = Math.max(block.width || 0, 24);
  var height = Math.max(block.height || 0, 24);
  if (x + width < view.left || x > view.right ||
      y + height < view.top || y > view.bottom) {
    return;
  }

  var ctx = this.ctx_;
  var dpr = this.dpr_;
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr,
      (view.tx + x * view.scale) * dpr, (view.ty + y * view.scale) * dpr);
  this.paintBlockBody_(block);
  this.paintInputShapes_(block);

  var childBlocks = block.getChildren();
  for (var i = 0; i < childBlocks.length; i++) {
    var child = childBlocks[i];
    if (!child.svgGroup_) {
      continue;
    }
    var xy = Blockly.utils.getRelativeXY(child.svgGroup_);
    this.renderBlock_(child, x + xy.x, y + xy.y, view);
  }
};

/**
 * Paint the background path of a block.
 * @param {!Blockly.BlockSvg} block The block to paint.
 * @private
 */
Blockly.CanvasRenderer.prototype.paintBlockBody_ = function(block) {
  var path = block.svgPath_;
  if (!path) {
    return;
  }
  var d = path.getAttribute('d');
  if (!d) {
    return;
  }
  var ctx = this.ctx_;
  this.applyElementTransform_(path);

  var fill = path.getAttribute('fill');
  var stroke = path.getAttribute('stroke');
  var alpha = parseFloat(path.getAttribute('fill-opacity'));
  if (isNaN(alpha)) {
    alpha = 1;
  }
  if (Blockly.utils.hasClass(block.svgGroup_, 'blocklyDisabled')) {
    alpha *= 0.5;
  }
  ctx.globalAlpha = alpha;
  var path2d = this.getPath2d_(d);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill(path2d);
  }
  if (stroke && !block.isInsertionMarker()) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke(path2d);
  }
  ctx.globalAlpha = 1;
};

/**
 * Paint the empty input holes of a block.
 * @param {!Blockly.BlockSvg} block The block to paint.
 * @private
 */
Blockly.CanvasRenderer.prototype.paintInputShapes_ = function(block) {
  var ctx = this.ctx_;
  for (var i = 0, input; input = block.inputList[i]; i++) {
    var outline = input.outlinePath;
    if (!outline) {
      continue;
    }
    var d = outline.getAttribute('d');
    if (!d) {
      continue;
    }
    if (outline.getAttribute('style') &&
        outline.getAttribute('style').indexOf('hidden') > -1) {
      continue;
    }
    this.applyElementTransform_(outline);
    var fill = outline.getAttribute('fill');
    var stroke = outline.getAttribute('stroke');
    var path2d = this.getPath2d_(d);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill(path2d);
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.stroke(path2d);
    }
  }
};

/**
 * Apply an element's own transform (RTL mirroring or input hole offsets) on
 * top of the current canvas transform.
 * @param {!Element} element The SVG element whose transform to apply.
 * @private
 */
Blockly.CanvasRenderer.prototype.applyElementTransform_ = function(element) {
  var transform = element.getAttribute('transform');
  if (!transform) {
    return;
  }
  var translateMatch = transform.match(
      /translate\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)\s*\)/);
  if (translateMatch) {
    this.ctx_.translate(parseFloat(translateMatch[1]),
        parseFloat(translateMatch[2]));
  }
  var scaleMatch = transform.match(
      /scale\(\s*([-\d.eE+]+)\s*[, ]\s*([-\d.eE+]+)\s*\)/);
  if (scaleMatch) {
    this.ctx_.scale(parseFloat(scaleMatch[1]), parseFloat(scaleMatch[2]));
  }
};

/**
 * Look up (or build) the cached Path2D object for a path definition.
 * @param {string} d The SVG path data.
 * @return {!Path2D} The parsed path.
 * @private
 */
Blockly.CanvasRenderer.prototype.getPath2d_ = function(d) {
  var cached = this.pathCache_[d];
  if (cached) {
    return cached;
  }
  var path = new Path2D(d);
  this.pathCache_[d] = path;
  this.pathCacheKeys_.push(d);
  if (this.pathCacheKeys_.length > Blockly.CANVAS_RENDERER_MAX_PATH_CACHE) {
    var oldest = this.pathCacheKeys_.shift();
    delete this.pathCache_[oldest];
  }
  return path;
};

/**
 * Clear the canvas layer.
 * @private
 */
Blockly.CanvasRenderer.prototype.clear_ = function() {
  if (!this.ctx_ || !this.canvas_) {
    return;
  }
  this.ctx_.setTransform(1, 0, 0, 1, 0, 0);
  this.ctx_.clearRect(0, 0, this.canvas_.width, this.canvas_.height);
};

/**
 * Dispose of the canvas layer.
 */
Blockly.CanvasRenderer.prototype.dispose = function() {
  this.disposed_ = true;
  if (this.frameHandle_ !== null) {
    window.cancelAnimationFrame(this.frameHandle_);
    this.frameHandle_ = null;
  }
  for (var id in this.paintOverrides_) {
    if (Object.prototype.hasOwnProperty.call(this.paintOverrides_, id)) {
      var block = this.workspace_ ? this.workspace_.getBlockById(id) : null;
      if (block) {
        this.setBlockPaintOverride(block, false);
      }
    }
  }
  this.paintOverrides_ = Object.create(null);
  if (this.workspace_) {
    var detachedIds = Object.keys(this.detachedBlocks_);
    for (var i = 0; i < detachedIds.length; i++) {
      var detachedBlock = this.workspace_.getBlockById(detachedIds[i]);
      if (detachedBlock) {
        this.ensureAttached_(detachedBlock);
      } else {
        delete this.detachedBlocks_[detachedIds[i]];
      }
    }
  }
  this.detachedBlocks_ = Object.create(null);
  this.promotedBlocks_ = Object.create(null);
  this.subtreeBoxes_ = Object.create(null);
  this.scriptIndexes_ = Object.create(null);
  this.activelyPromoted_ = null;
  if (this.workspace_ && this.workspace_.svgGroup_) {
    Blockly.utils.removeClass(this.workspace_.svgGroup_, 'blocklyCanvasMode');
  }
  if (this.foreignObject_) {
    goog.dom.removeNode(this.foreignObject_);
  }
  this.foreignObject_ = null;
  this.canvas_ = null;
  this.ctx_ = null;
  this.pathCache_ = Object.create(null);
  this.pathCacheKeys_ = [];
  this.workspace_ = null;
};

/**
 * Ask a workspace to repaint its canvas layer, if it has one.
 * @param {?Blockly.WorkspaceSvg} workspace The workspace that changed.
 * @param {boolean=} opt_forceCull Whether to recompute DOM culling.
 */
Blockly.CanvasRenderer.requestFor = function(workspace, opt_forceCull) {
  if (workspace && workspace.canvasRenderer_) {
    workspace.canvasRenderer_.requestRender(opt_forceCull);
  }
};
