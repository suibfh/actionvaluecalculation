// script.js
const NUM_CALCULATIONS = 50;
const MAX_UNITS_PER_SIDE = 5;
const ACTION_THRESHOLD = 1000;

// --- Data Structures ---

// Represents a unit
class Unit {
    constructor(id, name, baseAgility, side) {
        this.id = id; // Unique ID (e.g., 'player-1', 'enemy-3')
        this.name = name || `Unit ${id}`; // Default name
        this.baseAgility = baseAgility;
        this.actionValue = 0;
        this.side = side; // 'player' or 'enemy'
        this.actionCount = 0; // Number of times this unit has acted
        this.activeBuffs = []; // Array to hold active BuffDebuff objects
    }

    // Calculate effective agility based on active buffs/debuffs
    getEffectiveAgility() {
        let effectiveAgility = this.baseAgility;
        let skillBuffPercent = 0;
        let bbBuffPercent = 0;
        let heavyPressurePercent = 0; // Fixed -30%

        this.activeBuffs.forEach(buff => {
            if (buff.type === 'agility_buff_skill') {
                skillBuffPercent = Math.max(skillBuffPercent, buff.value);
            } else if (buff.type === 'agility_buff_bb') {
                bbBuffPercent = Math.max(bbBuffPercent, buff.value);
            } else if (buff.type === 'agility_debuff_heavy_pressure') {
                heavyPressurePercent = -30; // Heavy pressure is always -30%
            }
            // Action value buffs/debuffs don't affect effective agility per calculation
        });

        // Apply percentage effects (calculated based on base agility and floored)
        effectiveAgility += Math.floor(this.baseAgility * (skillBuffPercent / 100));
        effectiveAgility += Math.floor(this.baseAgility * (bbBuffPercent / 100));
        effectiveAgility += Math.floor(this.baseAgility * (heavyPressurePercent / 100));


        // Agility must be at least 1 (or some minimum game value if known)
        // Assuming it cannot go below 1 for calculation purposes
        return Math.max(1, effectiveAgility + 100); // Add the base 100 action value gain
    }

    // Add action value for one calculation
    addActionValue(value) {
        this.actionValue += value;
    }

    // Reset action value after acting
    resetActionValue() {
        this.actionValue = 0;
        this.actionCount++;
        // Decrement duration of active buffs/debuffs that count per action
        this.activeBuffs.forEach(buff => {
            if (buff.durationType === 'action') {
                buff.remainingDuration--;
            }
        });
        // Remove expired buffs/debuffs (will be handled in the main simulation loop after processing actions)
    }
}

// Represents a buff or debuff effect
class BuffDebuff {
    constructor(type, value, duration, durationType, startCalc, targetUnitIds) {
        this.type = type; // 'agility_buff_skill', 'agility_buff_bb', 'agility_debuff_heavy_pressure', 'action_value_up', 'action_value_down'
        this.value = value; // Percentage for agility, fixed value for action value
        this.duration = duration; // Total duration (in actions or calculations)
        this.remainingDuration = duration; // Duration left
        this.durationType = durationType; // 'action' or 'calculation'
        this.startCalc = startCalc; // The calculation turn this effect is applied
        this.targetUnitIds = targetUnitIds; // Array of unit IDs this effect targets
        this.id = Date.now() + Math.random(); // Simple unique ID for list rendering
    }

    getDescription(allUnits) {
        const targetNames = this.targetUnitIds.map(id => {
            const unit = allUnits.find(u => u.id === id);
            return unit ? unit.name : '不明なユニット';
        }).join(', ');

        let effectDesc = '';
        let durationDesc = '';

        if (this.type.startsWith('agility')) {
            effectDesc = `敏捷 ${this.value}% ${this.type.includes('buff') ? 'アップ' : 'ダウン'}`;
            durationDesc = `(${this.duration} 行動)`;
        } else { // action_value
             effectDesc = `行動値 ${this.value > 0 ? '+' : ''}${this.value}`;
             durationDesc = `(演算 ${this.startCalc} で付与)`;
        }

        return `${effectDesc} 対象: ${targetNames} ${durationDesc}`;
    }
}


// --- Global State ---
let allUnits = []; // Array of initial Unit objects from input
let activeBuffDebuffs = []; // Array of BuffDebuff objects added by the user

// --- UI Generation ---

// Function to generate unit input fields
function generateUnitInputs() {
    const playerInputsDiv = document.getElementById('player-units');
    const enemyInputsDiv = document.getElementById('enemy-units');
    const targetUnitsDiv = document.getElementById('buff-debuff-target-units');

    playerInputsDiv.innerHTML = '<h3>プレイヤーパーティ</h3>';
    enemyInputsDiv.innerHTML = '<h3>敵パーティ</h3>';
    targetUnitsDiv.innerHTML = ''; // Clear previous targets

    allUnits = []; // Clear previous units

    for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        // Player Unit
        const playerId = `player-${i}`;
        playerInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="${playerId}-name">ユニット ${i} (プレイヤー)</label>
                <input type="text" id="${playerId}-name" value="プレイヤー ${i}">
                <label for="${playerId}-agility">敏捷:</label>
                <input type="number" id="${playerId}-agility" value="100" min="1">
            </div>
        `;
         // Add to allUnits list for target selection
        allUnits.push(new Unit(playerId, `プレイヤー ${i}`, 100, 'player'));


        // Enemy Unit
        const enemyId = `enemy-${i}`;
         enemyInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="${enemyId}-name">ユニット ${i} (敵)</label>
                <input type="text" id="${enemyId}-name" value="敵 ${i}">
                <label for="${enemyId}-agility">敏捷:</label>
                <input type="number" id="${enemyId}-agility" value="100" min="1">
            </div>
        `;
         // Add to allUnits list for target selection
        allUnits.push(new Unit(enemyId, `敵 ${i}`, 100, 'enemy'));
    }

    // Generate target unit checkboxes
    allUnits.forEach(unit => {
        targetUnitsDiv.innerHTML += `
            <div>
                <input type="checkbox" id="target-${unit.id}" value="${unit.id}">
                <label for="target-${unit.id}">${unit.name}</label>
            </div>
        `;
    });

    // Add event listener to buff type select to toggle duration/calc input
    document.getElementById('buff-debuff-type').addEventListener('change', updateBuffInputFields);
    updateBuffInputFields(); // Initialize fields based on default selection
}

// Update input fields based on selected buff/debuff type
function updateBuffInputFields() {
    const typeSelect = document.getElementById('buff-debuff-type');
    const valueUnitSpan = document.getElementById('value-unit');
    const durationLabel = document.querySelector('.duration-label');
    const durationInput = document.querySelector('.duration-input');
    const calcLabel = document.querySelector('.calc-label');
    const calcInput = document.querySelector('.calc-input');

    const selectedType = typeSelect.value;

    if (selectedType.startsWith('agility')) {
        valueUnitSpan.textContent = '%';
        durationLabel.style.display = 'inline-block';
        durationInput.style.display = 'inline-block';
        calcLabel.style.display = 'none';
        calcInput.style.display = 'none';
    } else { // action_value
        valueUnitSpan.textContent = ''; // No unit or maybe '+'
        durationLabel.style.display = 'none';
        durationInput.style.display = 'none';
        calcLabel.style.display = 'inline-block';
        calcInput.style.display = 'inline-block';
    }
}


// Function to add a buff/debuff from input
function addBuffDebuff() {
    const typeSelect = document.getElementById('buff-debuff-type');
    const valueInput = document.getElementById('buff-debuff-value');
    const durationInput = document.querySelector('.duration-input');
    const calcInput = document.querySelector('.calc-input');
    const targetCheckboxes = document.querySelectorAll('#buff-debuff-target-units input[type="checkbox"]:checked');
    const activeBuffsList = document.getElementById('active-buff-debuffs');

    const type = typeSelect.value;
    const value = parseInt(valueInput.value);
    const targetUnitIds = Array.from(targetCheckboxes).map(cb => cb.value);

    if (targetUnitIds.length === 0) {
        alert('対象ユニットを1体以上選択してください。');
        return;
    }
     if (isNaN(value)) {
         alert('効果値を入力してください。');
         return;
     }


    let duration, durationType, startCalc;

    if (type.startsWith('agility')) {
        duration = parseInt(durationInput.value);
        durationType = 'action';
        startCalc = 1; // Agility buffs are active from the calculation they are applied
         if (isNaN(duration) || duration <= 0) {
             alert('効果ターンを1以上の数値で入力してください。');
             return;
         }
    } else { // action_value
        duration = 1; // Action value effects are instant (duration of 1 calculation)
        durationType = 'calculation';
        startCalc = parseInt(calcInput.value);
         if (isNaN(startCalc) || startCalc <= 0) {
             alert('付与演算を1以上の数値で入力してください。');
             return;
         }
    }

    const newBuff = new BuffDebuff(type, value, duration, durationType, startCalc, targetUnitIds);
    activeBuffDebuffs.push(newBuff);

    // Add to the displayed list
    const listItem = document.createElement('li');
    listItem.textContent = newBuff.getDescription(allUnits);
    const removeButton = document.createElement('button');
    removeButton.textContent = '削除';
    removeButton.onclick = () => removeBuffDebuff(newBuff.id);
    listItem.appendChild(removeButton);
    activeBuffsList.appendChild(listItem);

    // Clear inputs (optional)
    // valueInput.value = '0';
    // durationInput.value = '1';
    // calcInput.value = '1';
    // targetCheckboxes.forEach(cb => cb.checked = false);
}

// Function to remove a buff/debuff
function removeBuffDebuff(id) {
    activeBuffDebuffs = activeBuffDebuffs.filter(buff => buff.id !== id);
    renderActiveBuffsList(); // Re-render the list
}

// Function to re-render the list of active buffs/debuffs
function renderActiveBuffsList() {
    const activeBuffsList = document.getElementById('active-buff-debuffs');
    activeBuffsList.innerHTML = ''; // Clear current list
    activeBuffDebuffs.forEach(buff => {
        const listItem = document.createElement('li');
        listItem.textContent = buff.getDescription(allUnits);
        const removeButton = document.createElement('button');
        removeButton.textContent = '削除';
        removeButton.onclick = () => removeBuffDebuff(buff.id);
        listItem.appendChild(removeButton);
        activeBuffsList.appendChild(listItem);
    });
}


// --- Simulation Logic ---

// Function to run the simulation
function runSimulation() {
    // Get current unit data from inputs (in case agility changed)
    const currentUnitsData = getUnitsFromInputs();
     if (currentUnitsData.length === 0) {
        alert('ユニットを1体以上設定してください。');
        return;
    }

    const resultsTableBody = document.querySelector('#results-table tbody');
    const resultsTableHeader = document.querySelector('#results-table thead tr');

    // Clear previous results
    resultsTableBody.innerHTML = '';
    resultsTableHeader.innerHTML = '<th>演算</th>'; // Reset header

    // Add unit headers to the table
    currentUnitsData.forEach(unit => {
        const th = document.createElement('th');
        th.textContent = unit.name;
        resultsTableHeader.appendChild(th);
    });

    // Simulation loop
    // Create simulation units based on current input data
    const simulationUnits = currentUnitsData.map(unitData => new Unit(unitData.id, unitData.name, unitData.baseAgility, unitData.side));

    // Create a copy of active buffs/debuffs for the simulation
    const simulationBuffs = JSON.parse(JSON.stringify(activeBuffDebuffs)); // Simple deep copy

    for (let calc = 1; calc <= NUM_CALCULATIONS; calc++) {
        const row = document.createElement('tr');
        const calcCell = document.createElement('td');
        calcCell.textContent = calc;
        row.appendChild(calcCell);

        // --- Buff/Debuff Application (at the start of the calculation) ---
        const buffsToApplyThisCalc = simulationBuffs.filter(buff =>
            buff.durationType === 'calculation' && buff.startCalc === calc && buff.remainingDuration > 0
        );

        buffsToApplyThisCalc.forEach(buff => {
            buff.targetUnitIds.forEach(targetId => {
                const targetUnit = simulationUnits.find(unit => unit.id === targetId);
                if (targetUnit) {
                    if (buff.type.startsWith('action_value')) {
                        // Apply action value change immediately
                        targetUnit.addActionValue(buff.value);
                         // Mark cell for visual feedback (optional, can add a class)
                         // This is tricky to do here as we are building the row later.
                         // Will handle visual feedback during cell rendering.
                    } else {
                         // Agility buffs/debuffs applied at start of calc, affect getEffectiveAgility
                         // Need to add the buff object to the unit's activeBuffs list
                         // Check if a similar buff instance already exists? Or allow multiple instances?
                         // Based on previous discussion, multiple instances of the *effect* (e.g., skill+30%, skill+25%)
                         // contribute to the highest value calculation, so adding the object is correct.
                         const buffInstance = JSON.parse(JSON.stringify(buff)); // Copy the buff object
                         buffInstance.remainingDuration = buff.duration; // Reset duration for this application
                         targetUnit.activeBuffs.push(buffInstance);
                    }
                }
            });
             // For calculation-based buffs, they are 'consumed' on application
             buff.remainingDuration = 0; // Mark as applied for this simulation run
        });


        // --- Action Value Gain (based on effective agility) ---
        simulationUnits.forEach(unit => {
             // Only add action value if the unit didn't just act from an immediate AV buff
             // This requires checking if they acted in the immediate action phase below
             // For now, add to all, will refine immediate action later.
             if (!unit.actedImmediatelyInThisCalc) {
                 unit.addActionValue(unit.getEffectiveAgility());
             }
        });

        // --- Immediate Action Check (for action value buffs) ---
        // Check for units whose action value just reached >= 1000 due to action value buffs
        let immediateActingUnits = [];
        buffsToApplyThisCalc.forEach(buff => {
             if (buff.type.startsWith('action_value')) {
                 buff.targetUnitIds.forEach(targetId => {
                     const targetUnit = simulationUnits.find(unit => unit.id === targetId);
                      // Check if unit exists, wasn't already acting immediately, and now meets threshold
                     if (targetUnit && !immediateActingUnits.some(u => u.id === targetUnit.id) && targetUnit.actionValue >= ACTION_THRESHOLD) {
                         immediateActingUnits.push(targetUnit);
                         targetUnit.actedImmediatelyInThisCalc = true; // Mark for this calc
                     }
                 });
             }
        });

         // Process immediate actions
        immediateActingUnits.forEach(unit => {
            unit.resetActionValue(); // Reset AV, increment action count, decrement action-based buff durations
            // Buff duration decrement for action-based buffs happens in resetActionValue
        });


        // --- Main Action Check ---
        // Check for all units (excluding those who just acted immediately) that can act
        let mainActingUnits = simulationUnits.filter(unit =>
            unit.actionValue >= ACTION_THRESHOLD && !unit.actedImmediatelyInThisCalc
        );

        // Sort main acting units: higher action value first, then original input order
        mainActingUnits.sort((a, b) => {
            if (b.actionValue !== a.actionValue) {
                return b.actionValue - a.actionValue; // Higher action value first
            }
            // If action values are equal, sort by original input order
            const aIndex = currentUnitsData.findIndex(unit => unit.id === a.id); // Use original 'currentUnitsData' array for input order
            const bIndex = currentUnitsData.findIndex(unit => unit.id === b.id);
            return aIndex - bIndex; // Earlier in the list first
        });

        // Process main actions
        mainActingUnits.forEach(unit => {
            unit.resetActionValue(); // Reset AV, increment action count, decrement action-based buff durations
            // Buff duration decrement for action-based buffs happens in resetActionValue
        });

        // --- Buff/Debuff Duration Check (after actions) ---
        simulationUnits.forEach(unit => {
            // Remove expired action-based buffs/debuffs
            unit.activeBuffs = unit.activeBuffs.filter(buff =>
                !(buff.durationType === 'action' && buff.remainingDuration <= 0)
            );
             // Reset immediate action flag for the next calculation
             unit.actedImmediatelyInThisCalc = false;
        });


        // --- Display Results for this Calculation ---
        simulationUnits.forEach(unit => {
            const cell = document.createElement('td');

            const didActImmediately = immediateActingUnits.some(actingUnit => actingUnit.id === unit.id);
            const didActMain = mainActingUnits.some(actingUnit => actingUnit.id === unit.id);
            const didAct = didActImmediately || didActMain;

            if (didAct) {
                // Display "ACT (行動値)"
                // The actionValue was reset, so we can't get the exact value it reached *before* reset.
                // For now, display the threshold or a placeholder. Getting the exact value requires
                // storing the value just before reset, which adds complexity.
                // Let's display 'ACT (>=1000)' for now, or we can store the value before reset.
                // Storing before reset is better for accuracy. Let's add that.

                // To get the action value *before* reset, we need to capture it.
                // Let's modify the action processing to store the value.
                // For now, we'll display a placeholder or the threshold.
                // Displaying the threshold is a reasonable approximation.
                 cell.textContent = `ACT (>=${ACTION_THRESHOLD})`; // Placeholder for now
                 cell.classList.add('action-cell');
            } else {
                 cell.textContent = Math.floor(unit.actionValue); // Display current action value
            }

            // Optional: Highlight cells where buffs/debuffs were applied in this calc
            const buffsAppliedHere = buffsToApplyThisCalc.some(buff => buff.targetUnitIds.includes(unit.id));
            if (buffsAppliedHere) {
                // Determine if it was a buff or debuff for coloring
                const isDebuff = buffsToApplyThisCalc.some(buff => buff.targetUnitIds.includes(unit.id) && buff.type.includes('debuff'));
                if (isDebuff) {
                     cell.classList.add('debuff-applied-cell');
                } else {
                    cell.classList.add('buff-applied-cell');
                }
                 // Add tooltip or text indicating which buff/debuff was applied? Can be complex.
            }


            row.appendChild(cell);
        });

        resultsTableBody.appendChild(row);
    }
     // TODO: Refine action value display on ACT cells to show the actual value before reset
}

// Initialize unit input fields on page load
window.onload = generateUnitInputs;