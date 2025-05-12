// script.js
const NUM_CALCULATIONS = 50;
const MAX_UNITS_PER_SIDE = 5;
const ACTION_THRESHOLD = 1000;

// Unit data structure
class Unit {
    constructor(id, name, baseAgility, side) {
        this.id = id; // Unique ID (e.g., 'player-1', 'enemy-3')
        this.name = name || `Unit ${id}`; // Default name
        this.baseAgility = baseAgility;
        this.currentAgility = baseAgility; // Current agility affected by buffs/debuffs
        this.actionValue = 0;
        this.side = side; // 'player' or 'enemy'
        this.actionCount = 0; // Number of times this unit has acted
        this.buffs = []; // Array to hold active buff/debuff objects
    }

    // Calculate effective agility based on buffs/debuffs (Simplified for now)
    // TODO: Implement complex buff/debuff stacking logic here
    getEffectiveAgility() {
         // For now, just return base agility + 100
        return this.baseAgility + 100;
    }

    // Add action value for one calculation
    addActionValue() {
        this.actionValue += this.getEffectiveAgility();
    }

    // Reset action value after acting
    resetActionValue() {
        this.actionValue = 0;
        this.actionCount++;
        // TODO: Implement buff/debuff duration decrement based on actionCount
    }
}

// Function to generate unit input fields
function generateUnitInputs() {
    const playerInputsDiv = document.getElementById('player-units');
    const enemyInputsDiv = document.getElementById('enemy-units');

    playerInputsDiv.innerHTML = '<h3>プレイヤーパーティ</h3>';
    enemyInputsDiv.innerHTML = '<h3>敵パーティ</h3>';

    for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        // Player Unit
        playerInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="player-unit-${i}-name">ユニット ${i} (プレイヤー)</label>
                <input type="text" id="player-unit-${i}-name" value="プレイヤー ${i}">
                <label for="player-unit-${i}-agility">敏捷:</label>
                <input type="number" id="player-unit-${i}-agility" value="100" min="1">
            </div>
        `;

        // Enemy Unit
         enemyInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="enemy-unit-${i}-name">ユニット ${i} (敵)</label>
                <input type="text" id="enemy-unit-${i}-name" value="敵 ${i}">
                <label for="enemy-unit-${i}-agility">敏捷:</label>
                <input type="number" id="enemy-unit-${i}-agility" value="100" min="1">
            </div>
        `;
    }
}

// Function to get unit data from inputs
function getUnitsFromInputs() {
    const units = [];
    for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        // Player Unit
        const playerNameInput = document.getElementById(`player-unit-${i}-name`);
        const playerAgilityInput = document.getElementById(`player-unit-${i}-agility`);
        if (playerAgilityInput && parseInt(playerAgilityInput.value) > 0) {
             units.push(new Unit(`player-${i}`, playerNameInput.value, parseInt(playerAgilityInput.value), 'player'));
        }

        // Enemy Unit
        const enemyNameInput = document.getElementById(`enemy-unit-${i}-name`);
        const enemyAgilityInput = document.getElementById(`enemy-unit-${i}-agility`);
         if (enemyAgilityInput && parseInt(enemyAgilityInput.value) > 0) {
            units.push(new Unit(`enemy-${i}`, enemyNameInput.value, parseInt(enemyAgilityInput.value), 'enemy'));
        }
    }
    return units;
}

// Function to run the simulation
function runSimulation() {
    const units = getUnitsFromInputs();
    if (units.length === 0) {
        alert('ユニットを1体以上設定してください。');
        return;
    }

    const resultsTableBody = document.querySelector('#results-table tbody');
    const resultsTableHeader = document.querySelector('#results-table thead tr');

    // Clear previous results
    resultsTableBody.innerHTML = '';
    resultsTableHeader.innerHTML = '<th>演算</th>'; // Reset header

    // Add unit headers to the table
    units.forEach(unit => {
        const th = document.createElement('th');
        th.textContent = unit.name;
        resultsTableHeader.appendChild(th);
    });

    // Simulation loop
    // Create a deep copy of units for simulation to avoid modifying original input data
    const simulationUnits = units.map(unit => new Unit(unit.id, unit.name, unit.baseAgility, unit.side));

    for (let calc = 1; calc <= NUM_CALCULATIONS; calc++) {
        const row = document.createElement('tr');
        const calcCell = document.createElement('td');
        calcCell.textContent = calc;
        row.appendChild(calcCell);

        // Add action value for this calculation for all units
        simulationUnits.forEach(unit => {
            unit.addActionValue();
        });

        // Check for units that can act
        let actingUnits = simulationUnits.filter(unit => unit.actionValue >= ACTION_THRESHOLD);

        // Sort acting units: higher action value first, then original input order
        actingUnits.sort((a, b) => {
            if (b.actionValue !== a.actionValue) {
                return b.actionValue - a.actionValue; // Higher action value first
            }
            // If action values are equal, sort by original input order
            const aIndex = units.findIndex(unit => unit.id === a.id); // Use original 'units' array for input order
            const bIndex = units.findIndex(unit => unit.id === b.id);
            return aIndex - bIndex; // Earlier in the list first
        });

        // Process actions for acting units (in sorted order)
        actingUnits.forEach(unit => {
            // This unit acts
            // TODO: Implement action value up/down immediate action logic here if needed
            unit.resetActionValue(); // Reset action value after acting
            // TODO: Implement buff/debuff duration decrement here
        });


        // Display results for this calculation
        simulationUnits.forEach(unit => {
            const cell = document.createElement('td');
            // Check if this unit acted in this calculation
            const didAct = actingUnits.some(actingUnit => actingUnit.id === unit.id);

            if (didAct) {
                // Display "ACT (行動値)"
                // Find the action value *before* it was reset to 0
                // This requires storing the value just before reset, or calculating based on threshold
                // For simplicity now, we'll just show the threshold value or slightly above if it went over
                 const actionValueAtAct = unit.actionValue === 0 ? ACTION_THRESHOLD : unit.actionValue; // If reset, it was at least threshold
                 cell.textContent = `ACT (${Math.floor(actionValueAtAct)})`;
                 cell.classList.add('action-cell');
            } else {
                 cell.textContent = Math.floor(unit.actionValue); // Display current action value
            }
            row.appendChild(cell);
        });

        resultsTableBody.appendChild(row);
    }
}

// Initialize unit input fields on page load
window.onload = generateUnitInputs;

// TODO: Add UI and logic for buffs/debuffs and action value up/down
