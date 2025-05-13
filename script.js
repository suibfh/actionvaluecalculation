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
        this.actionValueAtAct = 0; // Store action value when acting
    }

    // Calculate effective agility based on active buffs/debuffs
    getEffectiveAgility() {
        let effectiveAgility = this.baseAgility;
        let skillBuffPercent = 0;
        let bbBuffPercent = 0;
        let heavyPressurePercent = 0; // Fixed -30%

        // Filter out expired buffs and apply active ones
        // Note: Calculation-based buffs are removed immediately after application in the simulation loop
        this.activeBuffs = this.activeBuffs.filter(buff => {
             // Keep buffs that are calculation-based (they are removed when applied)
             // Or action-based buffs with remaining duration > 0
             return buff.durationType === 'calculation' || buff.remainingDuration > 0;
        });


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
        return Math.max(1, effectiveAgility) + 100; // Add the base 100 action value gain
    }

    // Add action value for one calculation
    addActionValue(value) {
        this.actionValue += value;
    }

    // Reset action value after acting
    resetActionValue() {
        this.actionValueAtAct = this.actionValue; // Store value before reset
        this.actionValue = 0;
        this.actionCount++;
        // Decrement duration of active buffs/debuffs that count per action
        this.activeBuffs.forEach(buff => {
            if (buff.durationType === 'action') {
                // Decrement duration ONLY if the action count is greater than the action count when the buff was applied
                // This handles the self-applied buff logic (starts counting next action)
                // If the buff was self-applied (sourceUnitId === this.id), the first action *after* application starts the count.
                // If applied by another unit, the action *at* application starts the count.
                // The logic `this.actionCount > buff.appliedActionCount[this.id]` correctly handles both:
                // - Other unit applied: appliedActionCount is the actionCount *before* this action. current actionCount is +1. So this.actionCount > appliedActionCount is true.
                // - Self applied: appliedActionCount is the actionCount *before* this action. current actionCount is +1. The *next* action will have actionCount +2, which will be > appliedActionCount + 1.
                // This logic seems correct for "starts counting next action" for self-applied buffs.
                if (this.actionCount > buff.appliedActionCount[this.id]) {
                     buff.remainingDuration--;
                }
            }
        });
        // Removal of expired buffs happens in getEffectiveAgility or main simulation loop
    }
}

// Represents a buff or debuff effect
class BuffDebuff {
    constructor(type, value, duration, durationType, startCalc, targetUnitIds, sourceUnitId = null) {
        this.type = type; // 'agility_buff_skill', 'agility_buff_bb', 'agility_debuff_heavy_pressure', 'action_value_up', 'action_value_down'
        this.value = value; // Percentage for agility, fixed value for action value
        this.duration = duration; // Total duration (in actions or calculations)
        this.remainingDuration = duration; // Duration left
        this.durationType = durationType; // 'action' or 'calculation'
        this.startCalc = startCalc; // The calculation turn this effect is applied
        this.targetUnitIds = targetUnitIds; // Array of unit IDs this effect targets
        this.id = Date.now() + Math.random(); // Simple unique ID for list rendering
        this.sourceUnitId = sourceUnitId; // ID of the unit that applied this buff (null if not applicable)
        this.appliedActionCount = {}; // Track action count when applied for each target unit (key: unitId, value: actionCount)
    }

    getDescription(allUnits) {
        const targetNames = this.targetUnitIds.map(id => {
            const unit = allUnits.find(u => u.id === id);
            return unit ? unit.name : '不明なユニット';
        }).join(', ');

        let effectDesc = '';
        let durationDesc = '';
        let sourceDesc = this.sourceUnitId ? ` (付与元: ${allUnits.find(u => u.id === this.sourceUnitId)?.name || '不明'})` : '';


        if (this.type.startsWith('agility')) {
            effectDesc = `敏捷 ${this.value}% ${this.value >= 0 ? 'アップ' : 'ダウン'}`; // Use value sign for description
            durationDesc = `(${this.duration} 行動)`;
        } else { // action_value
             effectDesc = `行動値 ${this.value > 0 ? '+' : ''}${this.value}`;
             durationDesc = `(演算 ${this.startCalc} で付与)`;
        }

        return `${effectDesc} 対象: ${targetNames}${sourceDesc} ${durationDesc}`;
    }
}


// --- Global State ---
let allUnits = []; // Array of initial Unit objects from input
let activeBuffDebuffs = []; // Array of BuffDebuff objects added by the user

// --- UI Generation ---

// Function to generate unit input fields and target/source checkboxes/selects
function generateUnitInputs() {
    const playerInputsDiv = document.getElementById('player-units');
    const enemyInputsDiv = document.getElementById('enemy-units');
    const targetUnitsDiv = document.getElementById('buff-debuff-target-units');
    const sourceUnitSelect = document.getElementById('buff-debuff-source');

    playerInputsDiv.innerHTML = '<h3>プレイヤーパーティ</h3>';
    enemyInputsDiv.innerHTML = '<h3>敵パーティ</h3>';
    targetUnitsDiv.innerHTML = ''; // Clear previous targets
    sourceUnitSelect.innerHTML = '<option value="">なし (敵など)</option>'; // Reset source options

    allUnits = []; // Clear previous units

    // Generate Player Unit Inputs and add to allUnits
    for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        const playerId = `player-${i}`;
        playerInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="${playerId}-name">ユニット ${i} (プレイヤー)</label>
                <input type="text" id="${playerId}-name" value="プレイヤー ${i}">
                <label for="${playerId}-agility">敏捷:</label>
                <input type="number" id="${playerId}-agility" value="100" min="1">
            </div>
        `;
        const unit = new Unit(playerId, `プレイヤー ${i}`, 100, 'player');
        allUnits.push(unit);
         // Add to source unit select
        sourceUnitSelect.innerHTML += `<option value="${unit.id}">${unit.name}</option>`;
    }

    // Generate Enemy Unit Inputs and add to allUnits
     for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        const enemyId = `enemy-${i}`;
         enemyInputsDiv.innerHTML += `
            <div class="unit-input">
                <label for="${enemyId}-name">ユニット ${i} (敵)</label>
                <input type="text" id="${enemyId}-name" value="敵 ${i}">
                <label for="${enemyId}-agility">敏捷:</label>
                <input type="number" id="${enemyId}-agility" value="100" min="1">
            </div>
        `;
        const unit = new Unit(enemyId, `敵 ${i}`, 100, 'enemy');
        allUnits.push(unit);
        // Add to source unit select
        sourceUnitSelect.innerHTML += `<option value="${unit.id}">${unit.name}</option>`;
    }

    // Generate target unit checkboxes based on the order in allUnits
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


// Function to get unit data from inputs
function getUnitsFromInputs() {
    const units = [];
    for (let i = 1; i <= MAX_UNITS_PER_SIDE; i++) {
        // Player Unit
        const playerId = `player-${i}`;
        const playerNameInput = document.getElementById(`${playerId}-name`);
        const playerAgilityInput = document.getElementById(`${playerId}-agility`);
        if (playerNameInput && playerAgilityInput && parseInt(playerAgilityInput.value) > 0) {
             units.push(new Unit(playerId, playerNameInput.value, parseInt(playerAgilityInput.value), 'player'));
        }

        // Enemy Unit
        const enemyId = `enemy-${i}`;
        const enemyNameInput = document.getElementById(`${enemyId}-name`);
        const enemyAgilityInput = document.getElementById(`${enemyId}-agility`);
         if (enemyNameInput && enemyAgilityInput && parseInt(enemyAgilityInput.value) > 0) {
            units.push(new Unit(enemyId, enemyNameInput.value, parseInt(enemyAgilityInput.value), 'enemy'));
        }
    }
    return units;
}


// Function to add a buff/debuff from input
function addBuffDebuff() {
    const typeSelect = document.getElementById('buff-debuff-type');
    const valueInput = document.getElementById('buff-debuff-value');
    const durationInput = document.querySelector('.duration-input');
    const calcInput = document.querySelector('.calc-input');
    const targetCheckboxes = document.querySelectorAll('#buff-debuff-target-units input[type="checkbox"]:checked');
    const activeBuffsList = document.getElementById('active-buff-debuffs');
    const sourceUnitSelect = document.getElementById('buff-debuff-source');


    const type = typeSelect.value;
    const value = parseInt(valueInput.value);
    const targetUnitIds = Array.from(targetCheckboxes).map(cb => cb.value);
    const sourceUnitId = sourceUnitSelect.value || null; // Get selected source unit ID

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
        startCalc = 1; // Agility buffs are active from the calculation they are applied (assuming this based on previous discussion)
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

    const newBuff = new BuffDebuff(type, value, duration, durationType, startCalc, targetUnitIds, sourceUnitId);
    activeBuffDebuffs.push(newBuff);

    // Add to the displayed list
    const listItem = document.createElement('li');
    listItem.textContent = newBuff.getDescription(allUnits); // Use allUnits for description
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
    // sourceUnitSelect.value = '';
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
        listItem.textContent = buff.getDescription(allUnits); // Use allUnits for description
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
    // Corrected selector: '#results-table theable thead tr' -> '#results-table thead tr'
    const resultsTableHeader = document.querySelector('#results-table thead tr');

    // Clear previous results
    resultsTableBody.innerHTML = '';
    resultsTableHeader.innerHTML = '<th>演算</th>'; // Reset header

    // Add unit headers to the table in the correct order
    currentUnitsData.forEach(unit => {
        const th = document.createElement('th');
        th.textContent = unit.name;
        resultsTableHeader.appendChild(th);
    });

    // Simulation loop
    // Create simulation units based on current input data
    const simulationUnits = currentUnitsData.map(unitData => new Unit(unitData.id, unitData.name, unitData.baseAgility, unitData.side));

    // Create a deep copy of active buffs/debuffs for the simulation
    const simulationBuffs = JSON.parse(JSON.stringify(activeBuffDebuffs));
     // Re-initialize appliedActionCount and remainingDuration for the simulation copy
     simulationBuffs.forEach(buff => {
         buff.appliedActionCount = {}; // Reset for simulation
         buff.remainingDuration = buff.duration; // Reset duration for simulation
     });

    for (let calc = 1; calc <= NUM_CALCULATIONS; calc++) {
        const row = document.createElement('tr');
        const calcCell = document.createElement('td');
        calcCell.textContent = calc;
        row.appendChild(calcCell);

        // --- Buff/Debuff Application (at the start of the calculation) ---
        // Identify buffs/debuffs that are applied in this calculation
        const buffsToApplyThisCalc = simulationBuffs.filter(buff =>
            buff.startCalc === calc && buff.remainingDuration > 0 // Check startCalc and if not already consumed in simulation
        );

        buffsToApplyThisCalc.forEach(buff => {
            buff.targetUnitIds.forEach(targetId => {
                const targetUnit = simulationUnits.find(unit => unit.id === targetId);
                if (targetUnit) {
                    // Create a unique instance of the buff for the target unit
                    const buffInstance = JSON.parse(JSON.stringify(buff));
                    buffInstance.remainingDuration = buff.duration; // Set initial duration
                    // Record the action count of the target unit when the buff is applied
                    buffInstance.appliedActionCount[targetUnit.id] = targetUnit.actionCount;
                    targetUnit.activeBuffs.push(buffInstance);

                    if (buff.type.startsWith('action_value')) {
                        // Apply action value change immediately for AV buffs
                        targetUnit.addActionValue(buffInstance.value);
                        // Action value buffs are consumed immediately after application
                        buffInstance.remainingDuration = 0; // Mark instance as consumed
                    }
                     // For agility buffs, they are now in activeBuffs and affect getEffectiveAgility from this calc
                }
            });
             // Mark the original buff in simulationBuffs as consumed for this run
             buff.remainingDuration = 0; // This prevents it from being applied again in future calcs
        });


        // --- Action Value Gain (based on effective agility) ---
        simulationUnits.forEach(unit => {
             // Add action value based on effective agility
             unit.addActionValue(unit.getEffectiveAgility());
        });

        // --- Action Check and Processing ---
        // Check for all units that can act (>= 1000 AV)
        let actingUnits = simulationUnits.filter(unit => unit.actionValue >= ACTION_THRESHOLD);

        // Sort acting units: higher action value first, then original input order
        actingUnits.sort((a, b) => {
            if (b.actionValue !== a.actionValue) {
                return b.actionValue - a.actionValue; // Higher action value first
            }
            // If action values are equal, sort by original input order
            const aIndex = currentUnitsData.findIndex(unit => unit.id === a.id); // Use original 'currentUnitsData' array for input order
            const bIndex = currentUnitsData.findIndex(unit => unit.id === b.id);
            return aIndex - bIndex; // Earlier in the list first
        });

        // Process actions for acting units (in sorted order)
        actingUnits.forEach(unit => {
            // This unit acts
            unit.resetActionValue(); // Store value before reset, reset AV, increment action count, decrement action-based buff durations
            // Buff duration decrement for action-based buffs happens in resetActionValue
        });

        // --- Buff/Debuff Duration Check and Removal (after actions) ---
        simulationUnits.forEach(unit => {
            // Remove expired action-based buffs/debuffs from the unit's active list
            unit.activeBuffs = unit.activeBuffs.filter(buff => {
                 // Keep the buff if it's calculation-based (already handled by setting remainingDuration to 0 on application)
                 // or action-based with remaining duration > 0
                 return buff.durationType === 'calculation' ? buff.remainingDuration > 0 : buff.remainingDuration > 0;
             });
        });


        // --- Display Results for this Calculation ---
        // Ensure cells are added in the correct order matching the table header
        currentUnitsData.forEach(unitData => { // Iterate based on the original order
             const unit = simulationUnits.find(u => u.id === unitData.id); // Find the corresponding simulation unit
             const cell = document.createElement('td');

            const didAct = actingUnits.some(actingUnit => actingUnit.id === unit.id);

            if (didAct) {
                // Display "ACT (行動値)" using the stored value before reset
                 cell.textContent = `ACT (${Math.floor(unit.actionValueAtAct)})`;
                 cell.classList.add('action-cell');
            } else {
                 cell.textContent = Math.floor(unit.actionValue); // Display current action value
            }

            // Optional: Highlight cells where buffs/debuffs were applied in this calc
            // We need to check the buffInstances that were added to units' activeBuffs in this calc
            const buffsAppliedToThisUnitInThisCalc = simulationUnits.find(u => u.id === unit.id)?.activeBuffs.filter(buff =>
                 buff.startCalc === calc && buff.targetUnitIds.includes(unit.id) && buff.durationType === 'calculation' // Only highlight calculation-based buffs on application calc
            ) || [];

             // Also check for action-based buffs applied in this calc
             const actionBuffsAppliedToThisUnitInThisCalc = simulationBuffs.filter(buff =>
                 buff.startCalc === calc && buff.targetUnitIds.includes(unit.id) && buff.durationType === 'action'
             );


            if (buffsAppliedToThisUnitInThisCalc.length > 0 || actionBuffsAppliedToThisUnitInThisCalc.length > 0) {
                // Determine if it was a buff or debuff for coloring
                const isDebuff = buffsAppliedToThisUnitInThisCalc.some(buff => buff.type.includes('debuff')) || actionBuffsAppliedToThisUnitInThisCalc.some(buff => buff.type.includes('debuff'));
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
}

// Initialize unit input fields on page load
window.onload = generateUnitInputs;