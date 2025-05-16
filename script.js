// script.js
const NUM_CALCULATIONS = 50;
const MAX_UNITS = 10; // 最大ユニット数を10に変更
const ACTION_THRESHOLD = 1000;

// --- Data Structures ---

// Represents a unit
class Unit {
    // sideプロパティを削除
    constructor(id, name, baseAgility) {
        this.id = id; // Unique ID (e.g., 'unit-1', 'unit-10')
        this.name = name || `ユニット ${id.split('-')[1]}`; // デフォルト名を「ユニット X」に変更
        this.baseAgility = baseAgility;
        this.actionValue = 0;
        this.actionCount = 0; // Number of times this unit has acted
        this.activeBuffs = []; // Array to hold active BuffDebuff objects
        this.actionValueAtAct = 0; // Store action value when acting
    }

    // Calculate effective agility based on active buffs/debuffs
    // Pass current calculation number AND the list of units acting in this calculation
    getEffectiveAgility(currentCalc, actingUnitsInThisCalc) {
        let effectiveAgility = this.baseAgility;
        let skillBuffPercent = 0;
        let bbBuffPercent = 0;
        let heavyPressurePercent = 0; // Fixed -30%

        // Filter out expired buffs and apply active ones
        this.activeBuffs = this.activeBuffs.filter(buff => {
             // Keep buffs that are calculation-based (they are removed when applied)
             // Or action-based buffs with remaining duration > 0
             return buff.durationType === 'calculation' ? buff.remainingDuration > 0 : buff.remainingDuration > 0;
        });


        this.activeBuffs.forEach(buff => {
            // Check if the buff is active in the current calculation based on its startCalc
            if (currentCalc >= buff.startCalc) {
                // For action-triggered buffs applied in THIS calculation (currentCalc),
                // check if the target unit acted *before* the source unit in this calc's action order.
                if (buff.durationType === 'action' && buff.startCalc === currentCalc && buff.sourceUnitId) {
                    const sourceUnit = actingUnitsInThisCalc.find(u => u.id === buff.sourceUnitId);
                    const targetUnit = actingUnitsInThisCalc.find(u => u.id === this.id); // 'this' is the target unit

                    // If both source and target acted in this calc, and target acted before source
                    if (sourceUnit && targetUnit) {
                        const sourceIndex = actingUnitsInThisCalc.indexOf(sourceUnit);
                        const targetIndex = actingUnitsInThisCalc.indexOf(targetUnit);
                        if (targetIndex !== -1 && sourceIndex !== -1 && targetIndex < sourceIndex) {
                            // Agility effect of this specific buff instance is delayed until next calc (currentCalc + 1)
                            // Skip applying its agility value for *this* calculation
                            return; // Skip this buff for agility calculation in *this* turn
                        }
                    }
                    // If the target unit did NOT act in this calc, or acted after the source, the agility effect applies from this calc.
                    // If the source unit did NOT act in this calc (but the buff is action-triggered with startCalc=currentCalc, which shouldn't happen with current logic),
                    // the agility effect also applies from this calc.
                }
                // If the buff is calculation-triggered OR action-triggered but applied in a *previous* calculation,
                // OR action-triggered and applied in *this* calculation but the target acted after the source,
                // apply its agility value.

                if (buff.type === 'agility_buff_skill') {
                    skillBuffPercent = Math.max(skillBuffPercent, buff.value);
                } else if (buff.type === 'agility_buff_bb') {
                    bbBuffPercent = Math.max(bbBuffPercent, buff.value);
                } else if (buff.type === 'agility_debuff_heavy_pressure') {
                    heavyPressurePercent = -30; // Heavy pressure is always -30%
                }
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
                if (this.actionCount > (buff.appliedActionCount[this.id] || 0)) { // Use || 0 for safety if appliedActionCount wasn't set
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
            durationDesc = `(演算 ${this.startCalc} で付与, ${this.duration} 行動)`; // Added startCalc to description
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
    // player-unitsとenemy-unitsの代わりにall-unitsを使用
    const allUnitsDiv = document.getElementById('all-units');
    const targetUnitsDiv = document.getElementById('buff-debuff-target-units');
    const sourceUnitSelect = document.getElementById('buff-debuff-source');

    allUnitsDiv.innerHTML = '<h3>ユニット一覧</h3>'; // ヘッダーを変更
    targetUnitsDiv.innerHTML = ''; // Clear previous targets
    sourceUnitSelect.innerHTML = '<option value="">なし (敵など)</option>'; // Reset source options

    allUnits = []; // Clear previous units

    // Generate Unit Inputs (1 to 10)
    for (let i = 1; i <= MAX_UNITS; i++) {
        const unitId = `unit-${i}`; // IDフォーマットを変更
        allUnitsDiv.innerHTML += `
            <div class="unit-input">
                <label for="${unitId}-name">ユニット ${i}</label> <input type="text" id="${unitId}-name" value="ユニット ${i}"> <label for="${unitId}-agility">敏捷:</label>
                <input type="number" id="${unitId}-agility" value="100" min="1">
            </div>
        `;
        // sideプロパティを削除してUnitオブジェクトを作成
        const unit = new Unit(unitId, `ユニット ${i}`, 100);
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
        // 付与演算は常に表示
        calcLabel.style.display = 'inline-block';
        calcInput.style.display = 'inline-block';
    } else { // action_value
        valueUnitSpan.textContent = ''; // No unit or maybe '+'
        durationLabel.style.display = 'none';
        durationInput.style.display = 'none';
        // 付与演算は常に表示
        calcLabel.style.display = 'inline-block';
        calcInput.style.display = 'inline-block';
    }
}


// Function to get unit data from inputs
function getUnitsFromInputs() {
    const units = [];
    // ユニット1から10までを取得
    for (let i = 1; i <= MAX_UNITS; i++) {
        const unitId = `unit-${i}`;
        const unitNameInput = document.getElementById(`${unitId}-name`);
        const unitAgilityInput = document.getElementById(`${unitId}-agility`);
        // sideプロパティは不要になった
        if (unitNameInput && unitAgilityInput && parseInt(unitAgilityInput.value) > 0) {
             units.push(new Unit(unitId, unitNameInput.value, parseInt(unitAgilityInput.value)));
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
        startCalc = parseInt(calcInput.value); // 敏捷バフも付与演算を設定可能に
         if (isNaN(duration) || duration <= 0) {
             alert('効果ターンを1以上の数値で入力してください。');
             return;
         }
         if (isNaN(startCalc) || startCalc <= 0) { // 敏捷バフも付与演算の検証を追加
             alert('付与演算を1以上の数値で入力してください。');
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
    const resultsTableHeader = document.querySelector('#results-table thead tr');

    // Clear previous results
    resultsTableBody.innerHTML = '';
    resultsTableHeader.innerHTML = '<th>演算</th>'; // Reset header

    // Add unit headers to the table in the correct order
    // Iterate through the units in the desired display order (currentUnitsData)
    currentUnitsData.forEach(unit => {
        const th = document.createElement('th');
        th.textContent = unit.name;
        resultsTableHeader.appendChild(th);
    });

    // Simulation loop
    // Create simulation units based on current input data
    const simulationUnits = currentUnitsData.map(unitData => new Unit(unitData.id, unitData.name, unitData.baseAgility)); // sideプロパティは不要になった

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
        // Identify buffs/debuffs that are applied in this calculation due to a *calculation trigger*.
        const calcTriggeredBuffsToApplyThisCalc = simulationBuffs.filter(buff =>
            buff.durationType === 'calculation' && buff.startCalc === calc && buff.remainingDuration > 0 // Check startCalc and if not already consumed in simulation
        );

        calcTriggeredBuffsToApplyThisCalc.forEach(buff => {
             buff.targetUnitIds.forEach(targetId => {
                 const targetUnit = simulationUnits.find(unit => unit.id === targetId);
                 if (targetUnit) {
                     // Create a unique instance of the buff for the target unit
                     const buffInstance = JSON.parse(JSON.stringify(buff));
                     buffInstance.remainingDuration = buff.duration; // Set initial duration
                      // Record the action count of the target unit when the buff is applied
                     buffInstance.appliedActionCount[targetUnit.id] = targetUnit.actionCount;
                     targetUnit.activeBuffs.push(buffInstance);

                     if (buffInstance.type.startsWith('action_value')) {
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
        // Determine acting units *before* calculating AV gain to pass to getEffectiveAgility
        let potentialActingUnits = simulationUnits.filter(unit => unit.actionValue >= ACTION_THRESHOLD);
         // Sort potential acting units to determine action order in this calc
         potentialActingUnits.sort((a, b) => {
             if (b.actionValue !== a.actionValue) {
                 return b.actionValue - a.actionValue; // Higher action value first
             }
             // If action values are equal, sort by original input order
             // 単一リストになったため、元のcurrentUnitsDataのインデックスでソート
             const aIndex = currentUnitsData.findIndex(unit => unit.id === a.id);
             const bIndex = currentUnitsData.findIndex(unit => unit.id === b.id);
             return aIndex - bIndex; // Earlier in the list first
         });


        simulationUnits.forEach(unit => {
             // Add action value based on effective agility, considering buffs active from this calculation
             // Pass current calc and the determined action order for this calc
             unit.addActionValue(unit.getEffectiveAgility(calc, potentialActingUnits));
        });

        // --- Action Check and Processing ---
        // Re-check for units that can act after gaining AV
        let actingUnits = simulationUnits.filter(unit => unit.actionValue >= ACTION_THRESHOLD);

        // Sort acting units again based on updated AV and original order
        actingUnits.sort((a, b) => {
            if (b.actionValue !== a.actionValue) {
                return b.actionValue - a.actionValue; // Higher action value first
            }
            // If action values are equal, sort by original input order
            // 単一リストになったため、元のcurrentUnitsDataのインデックスでソート
            const aIndex = currentUnitsData.findIndex(unit => unit.id === a.id);
            const bIndex = currentUnitsData.findIndex(unit => unit.id === b.id);
            return aIndex - bIndex; // Earlier in the list first
        });

        // Process actions for acting units (in sorted order)
        // This is where action-triggered buffs/debuffs are applied
        actingUnits.forEach(unit => {
            // This unit acts
            unit.resetActionValue(); // Store value before reset, reset AV, increment action count, decrement action-based buff durations

            // --- Apply Action-Triggered Buffs/Debuffs (immediately after action) ---
            // Identify buffs/debuffs that are triggered by *this unit's* action at *this calculation*
             const actionTriggeredBuffsFromThisUnit = simulationBuffs.filter(buff =>
                 buff.durationType === 'action' && buff.startCalc === calc && buff.sourceUnitId === unit.id && buff.remainingDuration > 0 // Check trigger calc, source unit, and if not already consumed
             );

             actionTriggeredBuffsFromThisUnit.forEach(buff => {
                 buff.targetUnitIds.forEach(targetId => {
                     const targetUnit = simulationUnits.find(u => u.id === targetId);
                     if (targetUnit) {
                         // Create a unique instance of the buff for the target unit
                         const buffInstance = JSON.parse(JSON.stringify(buff));
                         buffInstance.remainingDuration = buff.duration; // Set initial duration
                         // Record the action count of the target unit *after* the source unit's action
                         // This is crucial for the "starts counting next action" logic
                         buffInstance.appliedActionCount[targetUnit.id] = targetUnit.actionCount; // Use target's actionCount *after* source acts
                         targetUnit.activeBuffs.push(buffInstance);
                     }
                 });
                 // Mark the original action-triggered buff in simulationBuffs as consumed for this run
                 buff.remainingDuration = 0; // Prevent it from being applied again
             });
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
        // Iterate based on the original order (currentUnitsData)
        currentUnitsData.forEach(unitData => {
             // Find the corresponding simulation unit for this original unit data
             const unit = simulationUnits.find(u => u.id === unitData.id);
             const cell = document.createElement('td');

            const didAct = actingUnits.some(actingUnit => actingUnit.id === unit.id);

            if (didAct) {
                // Display "ACT (行動値)" using the stored value before reset
                 cell.textContent = `ACT (${Math.floor(unit.actionValueAtAct)})`;
                 cell.classList.add('action-cell');
            } else {
                 cell.textContent = Math.floor(unit.actionValue); // Display current action value
            }

            // Optional: Highlight cells where buffs/debuffs were applied *in this calculation*
            // This includes both calculation-triggered and action-triggered buffs applied in this calc.
            const buffsAppliedToThisUnitInThisCalc = simulationUnits.find(u => u.id === unit.id)?.activeBuffs.filter(buff =>
                 // Check if the buff instance was added in this specific calculation turn
                 // A simple way is to check if its startCalc matches the current calc
                 // This might over-highlight if a buff is applied and immediately expires within the same calc,
                 // but for visual feedback on application timing, it's a reasonable approach.
                 // A more accurate way would be to temporarily mark buffs applied in this calc.
                 buff.startCalc === calc && buff.targetUnitIds.includes(unit.id)
            ) || [];


            if (buffsAppliedToThisUnitInThisCalc.length > 0) {
                // Determine if it was a buff or debuff for coloring
                const isDebuff = buffsAppliedToThisUnitInThisCalc.some(buff => buff.type.includes('debuff'));
                if (isDebuff) {
                     cell.classList.add('debuff-applied-cell');
                } else {
                    cell.classList.add('buff-applied-cell');
                }
                 // Add tooltip or text indicating which buff/debuff was applied? Can be complex.
            }

            // Append the created cell directly to the row
            row.appendChild(cell);
        });

        resultsTableBody.appendChild(row);
    }
}

// Initialize unit input fields on page load
window.onload = generateUnitInputs;