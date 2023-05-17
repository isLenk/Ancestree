const relationshipType = {
    0: {
        0: "Wife/Husband",
        1: "Daughter/Son",
    },

    1: {
        0: "Mother/Father",
        1: "Sister/Brother",
        2: "Niece/Nephew"
    },

    2: {
        0: "Grandmother/Grandfather",
        1: "Aunt/Uncle",
        2: "First Cousin",
        3: "First Cousin once removed"
    },

    3: {
        0: "Great-grandmother/Great-grandfather",
        1: "Great-aunt/Great-uncle",
        2: "First cousin once removed",
        3: "Second Cousin",
        4: "Second cousin once removed"
    },

    4: {
        0: "Great-great-grandmother/Great-great-grandfather",
        1: "Great-great-aunt/Great-great-uncle",
        2: "First cousin twice removed",
        3: "Second cousin once removed",
        4: "Third cousin",
        5: "Third cousin once removed"
    },
}
const UPDATE_INTERVAL = 2000

let cursor_state
let worldOrigin;
let canvasOrigin;
let originCircle;
let mousePositionOnDown = null;
let mouseDown = 0;

let tree;
let gridLayer;
let lineLayer;
let nodeLayer;

let gridEnabled = true;
let canvasDraggable = true;
const GRID_SIZE = 30;
const colorGridLines = "rgb(240,240,240)"
const colorConnection = "rgb(209, 206, 169)"
const mouse = {
    x: undefined,
    y: undefined
};

const Commands = {
    SelectRoot: 1,
    LinkNodes: 2
}

var editDialog;
const keypressed = {}
var currCommand = null;

const Genders = {
    Male: "M",
    Female: "F"
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion Failed.");
    }
}

// [Ancestral Depth][Descendant Depth]

function getRelationship(ancestor_depth, descendant_depth, gender) {
    let relation = relationshipType[ancestor_depth][descendant_depth].split("/")
    return relation.at(gender==Genders.Male && relation.length > 1)
}

const treeFilePrefix = "ANCESTREE-"
class Tree {
    constructor(name, root=null) {
        this.name = name;
        this.addRoot(root);
    }
    
    toJSON() {
        const jsonData = {
            name: this.name,
            root: this.root.name,
            families: [],
            nodes: [],
        }   
        
        Node.instances.forEach(node => {
            jsonData.nodes.push(node.toJSON())
        })

        Family.instances.forEach(family => {
            jsonData.families.push(family.toJSON())
        })

        return JSON.stringify(jsonData)
    }

    static fromJSON() {

    }
    
    static clear() {
        nodeLayer.removeChildren()
        lineLayer.removeChildren()

        while (Node.instances.length > 0) Node.instances.pop()
        while (Family.instances.length > 0) Family.instances.pop()
    }

    save(tree_name='default') {
        window.localStorage.setItem(treeFilePrefix + tree_name, this.toJSON())
    }

    static load(tree_name='default') {
        const result = window.localStorage.getItem(treeFilePrefix + tree_name)
        if (result) {
            Tree.clear()
            const {name, nodes, families, root} = JSON.parse(result)
            var rootNode = null;

            const relations = {}
            const nodesCreated = {}

            // Prepare families
            families.forEach(family => {
                const {father, mother, id} = family
                relations[id] = family
                relations[father] = [relations[id], "father"]
                relations[mother] = [relations[id], "mother"]
                relations[id].children = []
            })

            // Create nodes
            nodes.forEach(node => {
                const person = Person.fromJSON(node); 
                if (person.name == root) rootNode = person
                // Some voodoo referencing
                if (relations[person.name]) relations[person.name][0][relations[person.name][1]] = person
                if (person.root && relations[person.root]) relations[person.root].children.push(person)
                nodesCreated[person.name] = person
            })

            // Create families
            for (const [familyId, data] of Object.entries(relations)) {
                // Ignore the non-numeric entries
                if (typeof(familyId) == 'string' && isNaN(familyId)) continue
                const {color, father, mother, children, id} = data
                const family = new Family(father, mother)
                family.id = id
                family.setFamilyColor(color)
                family.addChildren(children)
            }

            tree = new Tree(name, rootNode)
            
            redraw();
            return tree
        } else {
            if (tree_name != "default") alert("Attempt to load tree, does not exist.")
            console.log(`Failed to load tree "${tree_name}"`)
            return false
        }
    }

    // The starting point of the tree,
    // Any node of the tree can be chosen as the root
    addRoot(root) {
        if (this.root) {
            this.root.isRoot(false)
        }
        this.root = root;
        this.root.isRoot(true)

        if (tree) this.castRelationships()
    }

    update() {
        Node.instances.forEach(node => node.update());
        Family.instances.forEach(node => node.update());
    }

    draw() {
        if (this.root == null) {
            return console.log("This tree does not contain a root.");
        }
        const originRadius = 5;
        // ctx.moveTo(50, 50);
        nodeLayer.activate();
        Node.instances.forEach(node => {
            node.draw();
        })
    }

    castRelationships(logRelations = false) {

        // Clear every instance
        Node.instances.forEach(node => {node.marked = false; node.relationObject.content = ''})
        const queue = [ [this.root, 0, 0] ]
        const pushed = []
        
        function cast(n, aD, dD) {
            if (n.marked) return 
            if (pushed.indexOf(n) >= 0) return 
            queue.push( [n, aD, dD] )
            pushed.push(n)
        }

        if (logRelations)  console.log(`\n\n\nCasting relationship with root( ${this.root.name} )`);
        while (queue.length > 0) {
            const [node, ancestor_depth, descendant_depth] = queue.shift()
            if (node.marked == true) continue;
            node.marked = true;

            // console.log(`*** Node (${node.name})`);
            
            if (node.family) {
                node.family.children.forEach(child => {cast(child[0], ancestor_depth, descendant_depth+1) })
                cast(node.family.spouse(node), ancestor_depth, descendant_depth) // Spouse
            }
            // Traverse parents
            if (node.root) {
                cast(node.root.mother, ancestor_depth+1, descendant_depth)
                cast(node.root.father, ancestor_depth+1, descendant_depth)
            }
            var relation = getRelationship(ancestor_depth, descendant_depth, node.gender)
            if (node === this.root) relation = 'Self'
            node.relationObject.content = relation
            if (logRelations) console.log(`${node.name.padEnd(20)} (${relation})`, `-> Ancestor(${ancestor_depth}) : Descendant(${descendant_depth})`)
        }

    }

    alignGenerations() {
        const DESCENT = 200

        const ancestors = []
        // Traverse through the families and determine the furthest ancestor they have
        Family.instances.forEach(family => {
            const father = family.father
            const mother = family.mother

            const father_roots = father.getFurthestAncestor()
            const mother_roots = mother.getFurthestAncestor()

            // Now that we have reached the top most, we can perform BFS to order

            // Check if we are not our own ancestor
            if (father_roots.family != father.family)
            if (ancestors.indexOf(father_roots.family) < 0) {
                ancestors.push(father_roots.family)
            }

            if (mother_roots.family != mother.family)
            if (ancestors.indexOf(mother_roots.family) < 0) {
                ancestors.push(mother_roots.family)
            }
        })

        function recursiveDrop(family, depth) {
            family.mother.offsetVector.y = (depth-1)*DESCENT
            family.father.offsetVector.y = (depth-1)*DESCENT
            family.children.forEach(child_data => {
                const [child, _] = child_data
                child.offsetVector.y = depth*DESCENT
                if (child.family) recursiveDrop(child.family, depth+1)
            })//.move(new paper.Point(0, -DESCENT*mother_roots.depth))
        }

        // Do BFS
        ancestors.forEach(ancestor => {
            // Traverse children, set their height below us
            recursiveDrop(ancestor, 1)
        });

        this.castRelationships()
        console.log(this.toJSON());
    }
}

function getMidpoint(start, end) {
    return new paper.Point(
        start.x + (end.x - start.x)/2,
        start.y + (end.y - start.y)/2
    )
}

function uniqueID() {
    return Math.floor(Math.random() * Date.now())
}

// Represents an immediate family consisting strictly of:
// Two biological parents.
// Arbitrary number of children
class Family {
    constructor(personA, personB, connectionLine=null, id=null) {
        const father = personA;
        const mother = personB;
        
        if (connectionLine == null) {
            const last = paper.project.activeLayer
            lineLayer.activate()
            connectionLine = new paper.Path();
            connectionLine.add(new paper.Point(0, 0));
            connectionLine.add(new paper.Point(0, 0));
            last.activate()
        }

        if (!id) id = uniqueID()

        // Get random color
        const r = randomInt(20, 230);
        const g = randomInt(20, 230);
        const b = randomInt(20, 230);

        // For now, assume generic
        this.id = id;
        this.father = father;
        this.mother = mother;
        this.targetElevation = this.father.offsetVector
        this.childTargetElevation = null
        this.bindLineEvents(connectionLine)
        this.connectionLine = connectionLine
        this.marked = false
        this.setFamilyColor(`rgb(${r}, ${g}, ${b})`)

        // Apply family
        if (father) father.family = this;
        if (mother) mother.family = this;

        this.children = [];
        Family.instances.push(this);
    }

    // ? toJSON() does not save the children, rather, the children should attach themselves
    toJSON() {
        const jsonData = {
            id: this.id,
            father: this.father.name,
            mother: this.mother.name,
            color: this.familyColor,
        }

        return jsonData
    }

    fromJSON(json) {
        return new Family(json.father, json.mother, id=json.id)
    }

    setFamilyColor(color) {
        this.familyColor = color;
        this.connectionLine.strokeColor = this.familyColor//colorConnection;
        this.connectionLine.strokeWidth = 8;
    }

    spouse = (who) => { 
        if ( !this.isParent(who) ) return;
        return [this.father, this.mother].at(who == this.father)
    }

    isParent = (s) => {return s == this.father || s == this.mother}

    bindLineEvents(line) {
        line.onMouseEnter = (e) => {
            line.selected = true;
            Family.focusedLine = this;
        }

        line.onMouseLeave = (e) => {
            line.selected = false;
            if (Family.focusedLine == this) Family.focusedLine = null;
        }
    }

    constrainParents() {
        // Check if distance between parents is too far
        const maximalDist = 300
        const minimalDist = 200
        const dist = this.father.visiblePosition.subtract(this.mother.visiblePosition).length
        // * This condition is only met when one is getting dragged.
        let target = this.father
        let traveller = this.mother

        if (this.mother == Node.nodeBeingDragged) {
            target = this.mother
            traveller = this.father
        }
        if (dist > maximalDist) { // ? Bind together
            const newOff = traveller.offsetVector.add(target.offsetVector.subtract(traveller.offsetVector).multiply(traveller.velocityScalar))
            traveller.setOffset(newOff)
        } else if (dist < minimalDist) { // ? Apply spacing
            const newOff = traveller.offsetVector.subtract(target.offsetVector.subtract(traveller.offsetVector).multiply(traveller.velocityScalar))
            traveller.setOffset(newOff)
        }
    }

    update() {
        // Adjust mother and father to fit target elevation
        if (this.targetElevation) {
            let yFatherPos = this.father.offsetVector.y + (this.targetElevation.y - this.father.offsetVector.y) * this.father.velocityScalar;
            let yMotherPos = this.mother.offsetVector.y + (this.targetElevation.y - this.mother.offsetVector.y) * this.mother.velocityScalar;
            this.father.setOffset(new paper.Point(this.father.offsetVector.x, yFatherPos));
            this.mother.setOffset(new paper.Point(this.mother.offsetVector.x, yMotherPos));

            // Remove once close enough.
            if ( Math.abs(this.targetElevation.y - this.father.offsetVector.y) < 0.05 && Math.abs(this.targetElevation.y - this.mother.offsetVector.y) < 0.05){
                this.father.setOffset(new paper.Point(this.father.offsetVector.x, this.targetElevation.y));
                this.mother.setOffset(new paper.Point(this.mother.offsetVector.x, this.targetElevation.y));
                this.targetElevation = null
            }
        }
        // Adjust child elevations if necessary
        if (this.childTargetElevation) {
            let canDisable = true;
            this.children.forEach(dat => {
                let [child, _] = dat;
                // SKIP FAMILIES
                if (!child.family) {
                    let pos = child.offsetVector.y + (this.childTargetElevation.y - child.offsetVector.y) * child.velocityScalar;
                    child.setOffset(new paper.Point(child.offsetVector.x, pos));

                    if (Math.abs(this.childTargetElevation.y - child.offsetVector.y) > 0.05) canDisable = false
                }
            })

            if (canDisable) {
                this.children.forEach(dat => {
                    let [child, _] = dat;
                    if (!child.family) {
                        child.setOffset(new paper.Point(child.offsetVector.x, this.childTargetElevation.y));
                    }
                })
                this.childTargetElevation = null
            }
            
        }

        this.connectionLine.firstSegment.point = this.father.visiblePosition
        this.connectionLine.lastSegment.point = this.mother.visiblePosition

        this.constrainParents()

        // Update children lines
        this.children.forEach(dat => {
            let [c, line] = dat
            line.firstSegment.point = c.visiblePosition; // At Node
            line.lastSegment.point = getMidpoint(this.father.visiblePosition, this.mother.visiblePosition); // At relational line
            line.segments[2].point = line.lastSegment.point.add(new paper.Point(0, 90)); // Relational line stem down
            const joint1Pos = new paper.Point(line.firstSegment.point.x, line.segments[2].point.y) // Node upwards step
            line.segments[1].point = joint1Pos; //c.visiblePosition.subtract(new paper.Point(0, 100));
        })
    }

    move = (y) => this.targetElevation = y
    onDrag = (offset) => this.targetElevation = offset
    onChildDrag = (offset) => this.childTargetElevation = offset

    addChildren(children) {
        children.forEach(c => this.addChild(c))
    }

    addChild(childNode, line=null) {
        if (line == null) {
            const last = paper.project.activeLayer
            lineLayer.activate()
            line = new paper.Path();
            line.strokeWidth = 10;
            line.add(childNode.visiblePosition);
            line.add(childNode.visiblePosition);
            last.activate()
        }

        line.strokeColor = this.familyColor || colorConnection;
        // Add segments to line
        const start = line.firstSegment.point
        const end = line.lastSegment.point
        line.removeSegments(); // Remove existing segment
        // ? Replace line with four segment line
        const segments = 4
        for (let i = 0; i < segments; i++) {
            let vector = end.subtract(start);
            const pos = start.add(vector.multiply((i/segments)))//new paper.Point(start.x + vector.x * (i/segments), start.y + vector.y * (i/segments) )
            line.add(pos)
        }
        // line.smooth()
        this.children.push([childNode, line]);
        childNode.root = this;
    }

    removeChild(childNode) {
        let i = 0;
        for (i = 0; i < this.children.length; i++) {
            if (this.children[i][0] == childNode) break;
        }

        if (i != this.children.length) {
            if (i < 0) {return console.log("Child does not exist.");}
            this.children[i][1].remove();
            this.children.splice(i, 1);
            childNode.root = null
        }
    }

    remove() {
        this.father.family = null;
        this.mother.family = null;
        this.children.forEach((dat) => {let [child, line] = dat; child.family = null; line.remove()});
        this.connectionLine.remove()
        Family.instances.splice(Family.instances.indexOf(this), 1);
        delete this
    }
}
Family.instances = [];

// Abstract interface to represent animatable objects
class Animated {
    constructor(velocityScalar, offsetVector = defaultOffsetVector) {
        this.velocityScalar = velocityScalar;
        this.offsetVector = offsetVector;
    };    
    
    draw = () => {throw new ReferenceError("Undefined draw()")};
    update = () => {this.draw();};
    setPosition = (position) => this.position = position;
    setOffset = (offset) => this.offsetVector = offset;
}

const inputStates = {
    connectMode: false,
}

var ghostPath;
function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max-min));
}

var focusedNode = null;

// Represents a node of the family tree.
class Node extends Animated {
    constructor(name) {
        const velocity = randomInt(70, 100) / 1000;
        let offsetVector = new paper.Point(randomInt(-150, 150), randomInt(-150, 150)); 
        super(velocity, offsetVector);
        this.name = "Unnamed"
        this.setPosition(canvasOrigin);
        Node.instances.push(this);
    }

    setName(name) {
        this.name = name;
        this.nameObject.content = name
        
    }

    toJSON() {
        return {name: this.name, offset: this.offsetVector}
    }

    fromJSON(node) {

    }

    draw = () => {
        const [offPosX, offPosY] = [this.position.x + this.offsetVector.x, this.position.y + this.offsetVector.y];
        this.sprite.position = new paper.Point(offPosX, offPosY);
        this.visiblePosition = this.sprite.position;
    }

    update = () => {
        // Attach to origin of canvas.
        const [offPosX, offPosY] = [this.position.x, this.position.y];
        this.position = new paper.Point(offPosX + (canvasOrigin.x - offPosX)*this.velocityScalar,  
                            offPosY + (canvasOrigin.y - offPosY)*this.velocityScalar
                            )
    }

    isRoot = (value) => {
        this.boundingRect.fillColor = ['rgb(250,250,250)', 'rgb(226, 216, 242)'].at(!!value)
        this.boundingRect.strokeColor = ['rgb(50,50,50)', 'rgb(137, 74, 255)'].at(!!value)
    }
    

}
Node.instances = [];

// A better suited name for node
class Person extends Node {
    constructor(name) {
        super(name);
        this.family = null;
        this.root = null;
        this.gender = Genders.Male;
        this.marked = false
        this.generateSprite();
        this.setName(name)
    }

    toJSON() {
        const jsonData = {
            name: this.name, 
            gender: this.gender,
            offset: this.offsetVector
        }
        if (this.family) jsonData['family'] = this.family.id
        if (this.root) jsonData['root'] = this.root.id
        return jsonData
    }

    generateSprite() { // Called by constructor
        const boundingRect = new paper.Rectangle(new paper.Point(0,0), new paper.Point(200, 80))
        const sprite = new paper.Path.Rectangle(
            boundingRect, 
            new paper.Size(10, 10) 
            )


        sprite.fillColor = 'rgb(250,250,250)'
        sprite.strokeColor = 'rgb(50,50,50)'

        var name = new paper.PointText({
            position: boundingRect.topLeft.add(new paper.Point(5, 20)),
            content: this.name,//.replaceAll(" ","\n"),
            // justification: 'bottom',
            fontSize: 15,
            fillColor: 'black',
            locked: true,
            fontFamily: 'Courier New',
            // fontWeight: 'bold'
        });
        
        var dob = new paper.PointText({
            position: boundingRect.topLeft.add(new paper.Point(5, 45)),
            content: "",//"YYYY-MM-DD",//.replaceAll(" ","\n"),
            // justification: 'bottom',
            fontSize: 15,
            fillColor: 'black',
            locked: true,
            // fontFamily: 'Times-New Roman',
            // fontWeight: 'bold'
        });

        var relation = new paper.PointText({
            position: boundingRect.topLeft.add(new paper.Point(5, 65)),
            content: "...",//.replaceAll(" ","\n"),
            // justification: 'bottom',
            fontSize: 15,
            fillColor: 'black',
            locked: true,
            // fontFamily: 'Times-New Roman',
            // fontWeight: 'bold'
        });

        this.nameObject = name;
        this.relationObject = relation
        this.boundingRect = sprite

        this.attachSpriteEvents(sprite)
        this.sprite = new paper.Group({
            children: [sprite, name, dob, relation],
            applyMatrix: false
        });        
    }

    attachSpriteEvents(sprite) {
        sprite.onMouseEnter = (e) => {
            sprite.selected = true;
            focusedNode = this;
        }

        sprite.onMouseLeave = (e) => {
            sprite.selected = false;
            if (focusedNode == this) focusedNode = null;
        }

        sprite.onMouseDown = (e) => {
            this.originalOffset = this.offsetVector;
            if (e.modifiers.shift) { // Create projection path
                inputStates.connectMode = true;
                lineLayer.activate()
                ghostPath = new paper.Path();
                ghostPath.strokeColor = colorConnection;
                ghostPath.strokeWidth = 10;
                ghostPath.locked = true;
                ghostPath.add(this.visiblePosition);
                ghostPath.add(paper.view.projectToView(getMousePos()));
                nodeLayer.activate();
            }
        }

        sprite.onMouseDrag = (e) => {
            if (!this.originalOffset) return;
            canvasDraggable = false;
            Node.nodeBeingDragged = this;

            if (inputStates.connectMode) {
                ghostPath.lastSegment.point = getMousePos()

            } else { // Default to Drag Instance
                const mP = paper.view.projectToView(getMousePos()).divide(paper.view.zoom);
                const tP = paper.view.projectToView(mousePositionOnDown).divide(paper.view.zoom)
                this.offsetVector = this.originalOffset.add(mP.subtract(tP))

                if (this.family && this.family.isParent(this)) {
                    this.family.onDrag(this.offsetVector)
                }
                
                if (this.root && !this.family) {
                    this.root.onChildDrag(this.offsetVector)}
                }
        }

        sprite.onMouseUp = (e) => {
            Node.nodeBeingDragged = null;
            canvasDraggable = true;
            this.originalOffset = null;
            inputStates.connectMode = false;
            if (ghostPath != null) {

                ghostPath.locked = false;
                // Determine if a connection was made
                if (focusedNode != this && focusedNode != null) { // The focused node is another node
                    // Check if the family already exists.
                    if (this.family) {
                        this.family.remove();
                    }
                    else {
                        // Determine if the either node has a family already.
                        if (!focusedNode.family) {
                            new Family(this, focusedNode, ghostPath.clone())
                        }
                    }
                } else if (Family.focusedLine){ // Check if connecting to a family line
                    if (this.root == Family.focusedLine) {
                        this.root.removeChild(this)
                    } else {
                        Family.focusedLine.addChild(this, ghostPath.clone());
                    }
                }
                ghostPath.remove();
                ghostPath = null;

            } else {
                if (currCommand == Commands.SelectRoot) tree.addRoot(this)
            }
        }

        sprite.onDoubleClick = (e) => {
            canvasOrigin = getCenter().subtract(this.offsetVector)
            
            if (!focusedNode) return
            toggleEdit(focusedNode)
        }

    }

    static fromJSON(node) {
        const {gender, name, offset, root} = node;
        const person = new Person(name);
        person.setGender(gender)
        person.setOffset(new paper.Point(offset[1], offset[2]))
        person.root = root;
        return person
    }

    setGender = (g) => this.gender = g;
    getFurthestAncestor() {
        function recurse(target, depth) {
            // Target is at the topmost of tree
            if (!target.root) return [target.family, depth]

            // Check mother and father
            const [father, father_depth] = recurse(target.root.mother, depth+1)
            const [mother, mother_depth] = recurse(target.root.father, depth+1)
            
            if (father_depth > mother_depth) {
                return [father, father_depth]
            } else {
                return [mother, mother_depth]
            }
        }

        const [family, depth] = recurse(this, 0)
        return {family: family, depth: depth}
    }

    remove() {

        if (this.family) this.family.remove()
        if (this.root) this.root.removeChild(this)

        this.sprite.removeChildren()
        this.sprite.remove()
        Node.instances.splice(Node.instances.indexOf(this), 1)
    }
};

function drawGrid() {
    gridLayer.removeChildren()
    if (!gridEnabled) { return }
    gridLayer.activate();
    let viewWidth = paper.view.viewSize.getWidth();
    let viewHeight = paper.view.viewSize.getHeight();

    var xStart = canvasOrigin.x % GRID_SIZE;
    var yStart = canvasOrigin.y % GRID_SIZE;

    for (var x = xStart; x < viewWidth; x += GRID_SIZE) {
        let from = new paper.Point(x, 0);
        let to = new paper.Point(x, viewHeight);
        let path = new paper.Path.Line(from, to);
        path.strokeColor = colorGridLines;
    }
    
    for (var y = yStart; y < viewHeight; y += GRID_SIZE) {
        let from = new paper.Point(0, y);
        let to = new paper.Point(viewWidth, y);
        let path = new paper.Path.Line(from, to);
        path.strokeColor = colorGridLines;
    }
}

function drawOrigin() {
    gridLayer.activate();
    originCircle = new paper.Path.Circle({
        center: paper.view.center,
        radius: 9,
        fillColor: colorGridLines,
    });
    originCircle.position = canvasOrigin;
}

function redraw() {
    gridLayer.removeChildren();
    drawGrid();
    drawOrigin();
    tree.draw();
    paper.view.draw();
}

function onResize(event) {
    paper.view.viewSize.width = window.innerWidth;
    paper.view.viewSize.height = window.innerHeight;
    redraw();
    worldOrigin = getCenter();
}

function getCenter() {
    viewWidth = paper.view.viewSize.getWidth();
    viewHeight = paper.view.viewSize.getHeight();
    return new paper.Point(viewWidth/2, viewHeight/2);
}

function getAdjustedVector(origin, amount) {
    return new paper.Point(origin.x + amount.x, origin.y + amount.y);
}

function getOffsetByMouse(origin) {
    offset = getMousePos();
    offset.x -= mousePositionOnDown.x;
    offset.y -= mousePositionOnDown.y;

    return getAdjustedVector(origin, offset)
}

function moveOrigin() {
    if (!canvasDraggable) return;
    if (inputStates.connectMode) return;
    if (mouseDown && mousePositionOnDown) {
        canvasOrigin = getOffsetByMouse(canvasOrigin);
        mousePositionOnDown = getMousePos();
        redraw();
    }
}

function getMousePos() {
    return new paper.Point(mouse.x, mouse.y)
}

function onKeyUp(event) {
    keypressed[event.key] = false
    switch (event.key) {
        case "r":
            if (!canvasDraggable) break;
            canvasOrigin = worldOrigin;
            paper.view.zoom = 1
            redraw();
            break;
        case "c":
            const entity = new Person("New Person #" + nodeLayer.children.length);
            entity.setPosition(new paper.Point(mouse.x, mouse.y))
            break;
        case "e":
            if (!focusedNode) return
            toggleEdit(focusedNode)
    }

    checkKeybinds()
}

var nodeToEdit = null;
function toggleEdit(node) {
    nodeToEdit = node
    
    // Fill entries with appropriate data
    $("#edit-name").val(node.name)
    // $("#edit-birthday").val(node.)
    
    switch (node.gender) {
        case Genders.Male:
            $('input#male').prop("checked", true)
            console.log($("input#male").val())
            break;
        case Genders.Female:
                $('input#female').prop("checked", true)
                break;
    }


    if (editDialog[0].open) editDialog[0].close()
    else editDialog[0].showModal()
}

function bindEditDialog() {
    $('#edit-name').change(function() {
        if (!nodeToEdit) return
        nodeToEdit.setName($('#edit-name').val())
    })

    $('#edit-form input').on('change', function() {
        const selection = $('input[name=sex]:checked', "#edit-form").val();
        nodeToEdit.setGender(selection)
        tree.castRelationships()
    })

    // Hide when click outside
    $("dialog").on("click", (e) => {if (e.target === editDialog[0]) editDialog[0].close()})
    $('#delete-person').on("click", (e) => {
        if (!nodeToEdit) return
        if (confirm(`Press OK to delete person: ${nodeToEdit.name}`) != true) return
        nodeToEdit.remove()
        editDialog[0].close()
    })
}

function createTemporaryTree() {
    console.log("Generating temporary tree")
    nodeLayer.activate();
    // Temp Tree is the british monarchy
    const kingGeorgeVI = new Person("King George VI")
    const queenElizabeth = new Person("Queen Elizabeth")
    const queenElizabeth2 = new Person("Queen Elizabeth II")
    const princePhilip = new Person("Prince Philip")
    const princessMargaret = new Person("Princess Margaret")
    const camila = new Person("Camila")
    const charles = new Person("Charles")
    const diana = new Person("Princess of Wales")
    const anne = new Person("Anne")
    const princeAndrew = new Person("Prince Andrew")
    const princeEdward = new Person("Prince Edward")
    const catherine = new Person("Catherine")
    const princeWilliam = new Person("Prince William")
    const princeHarry = new Person("Prince Harry")
    const meghan = new Person("Meghan")
    const princeGeorge = new Person("Prince George of Cambridge")
    const princessCharlotte = new Person("Princess Charlotte of Cambridge")
    const princeLouis = new Person("prince Louis of Cambridge")
    const archieHarrison = new Person("Archie Harrison Mountbatten-Windsor")

    const kingGeorgeAndElizabeth = new Family(kingGeorgeVI, queenElizabeth)
    const princePhilipsAndElizabethII = new Family(princePhilip, queenElizabeth2)
    const charlesAndDiana = new Family(charles, diana)
    const harryAndMeghan = new Family(princeHarry, meghan)
    const catherineAndWilliam = new Family(princeWilliam, catherine)
    const camilaAndCharles = new Family(charles, camila)

    kingGeorgeAndElizabeth.addChildren([queenElizabeth2, princessMargaret])
    princePhilipsAndElizabethII.addChildren([charles, anne, princeAndrew, princeEdward])
    charlesAndDiana.addChildren([princeWilliam, princeHarry])
    harryAndMeghan.addChild(archieHarrison)
    catherineAndWilliam.addChildren([princeGeorge, princessCharlotte, princeLouis])

    return new Tree("British Monarchy, House of Windsor", queenElizabeth2);
}


function onKeyDown(event) {
    keypressed[event.key] = true

    checkKeybinds()
}

function checkKeybinds() {
    if (keypressed['shift']) {
        if (currCommand == Commands.LinkNodes) return
        currCommand = Commands.LinkNodes
        cursor_state.content = "Create Relation"
        
    } else if (keypressed['control']) {
        if (currCommand == Commands.SelectRoot) return
        currCommand = Commands.SelectRoot
        cursor_state.content = "Select Root"
    } else {
        currCommand = null;
        cursor_state.content = ""
    }
}

function onFrame() {
    tree.update();
    tree.draw();
}

cursor_state_offset = 25
function onMouseMove(event) {
    cursor_state.point = event.point.add(cursor_state_offset)
}

window.onload = function() {
    var canvas = document.getElementById("treeCanvas");
    paper.setup(canvas);
    canvasOrigin = getCenter();
    worldOrigin = getCenter();
    gridLayer = paper.project.activeLayer;
    lineLayer = new paper.Layer();
    nodeLayer = new paper.Layer();
    tree = Tree.load()
    if (!tree) tree = createTemporaryTree();
    console.log(tree)
    redraw();

    cursor_state = new paper.PointText({
        point: paper.view.center,
        content: '',
        justification: 'left',
        fontSize: 15
    });
    
    document.body.onmousedown = function() { 
        mousePositionOnDown = getMousePos();
        mouseDown = 1;
    }

    document.body.onmouseup = function() {
        mouseDown = 0;
    }

    var intervalId = window.setInterval(function(){
        tree.save()
    }, UPDATE_INTERVAL);
    paper.view.onFrame = onFrame
    paper.view.onKeyDown = onKeyDown
    paper.view.onKeyUp = onKeyUp;
    paper.view.onMouseMove = onMouseMove;

    editDialog = $('#edit-modal')
    $('#edit-close').on("click", _ => {editDialog[0].close()})
    bindEditDialog()
    const menu_btn = $('#menu-btn')
    const details_closebtn = $('#close-details-btn')
    const details_panel = $('#details')

    menu_btn.on("click", _ => {details_panel.toggleClass("details-hidden")});
    details_closebtn.on("click", _ => {details_panel.toggleClass("details-hidden")})
    
    const form = document.getElementById('edit-form');
    form.addEventListener('keypress', function(e) {
      if (e.keyCode === 13) {
        e.preventDefault();
      }
    });

}

// Credit > Filipp Procenko
function adjustZoom(e) {
    if (e.deltaY == 0) return
    const MIN = 0.1;
    const MAX = 3;
    const STEP = 10
    const GRID_THRESH = 1;

    zoomAmt = paper.view.zoom / STEP
    const mousePosition = getMousePos()
    const origCursorAt = paper.view.projectToView(mousePosition)
    
    // Apply zoom
    paper.view.zoom += zoomAmt * (e.deltaY < 0 ? 1 : -1)

    // Round zoom to first decimal
    paper.view.zoom = Math.round(paper.view.zoom * 10) / 10
    paper.view.zoom = Math.min(Math.max(paper.view.zoom, MIN), MAX)

    if (gridEnabled != (paper.view.zoom >= GRID_THRESH)) {
        gridEnabled = paper.view.zoom >= GRID_THRESH
        drawGrid()
    }

    const adjustedCursorAt = paper.view.projectToView(mousePosition)
    const trans = [((origCursorAt.x - adjustedCursorAt.x) / paper.view.zoom), ((origCursorAt.y - adjustedCursorAt.y) / paper.view.zoom)];
    canvasOrigin = canvasOrigin.add(trans)
    $("#zoom-value").text(Number(paper.view.zoom).toFixed(1))
}

window.addEventListener('mousemove', function (e) {
    mouse.x = e.x;
    mouse.y = e.y;
    moveOrigin();
});

// paper.view.onResize = onResize;
addEventListener("resize", onResize);
window.addEventListener("wheel", adjustZoom)
