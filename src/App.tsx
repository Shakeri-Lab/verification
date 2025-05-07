import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import debounce from 'lodash/debounce';

// Assuming these paths are correct for your project structure
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// --- Interfaces ---
interface Diagnosis {
  id: string;
  name: string;
  description: string;
}

interface Group {
  id: string;
  name: string;
  diagnoses: Diagnosis[];
  subgroups?: Group[];
  collapsed?: boolean;
}

// Type for the data structure expected from diagnoses.json
interface DiagnosesData {
  [groupId: string]: [string[], string[]]; // [codes, names]
}

// Type for the NEW data structure saved to S3/localStorage
interface SavedSessionData {
    confirmedGroups: Group[];
    unsortedDiagnoses: Diagnosis[];
}

// Type guard to check if loaded data is the new format
function isNewSaveFormat(data: any): data is SavedSessionData {
    // Check if it's an object, not null, not an array, and has at least one of the expected keys
    return data && typeof data === 'object' && !Array.isArray(data) && ('confirmedGroups' in data || 'unsortedDiagnoses' in data);
}


const DiagnosisGroupingApp = (): React.JSX.Element => {
  // --- State Variables ---
  const [undoStack, setUndoStack] = useState<SavedSessionData[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [showAddGroupInput, setShowAddGroupInput] = useState(false);
  const [savedMessage, setSavedMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]); // User's confirmed groups
  const [computingId, setComputingId] = useState(''); // Initialize empty
  const [suggestedGroups, setSuggestedGroups] = useState<Group[]>([]); // Filtered suggested groups
  const [deletedDiagnoses, setDeletedDiagnoses] = useState<Diagnosis[]>([]); // Unsorted/deleted diagnoses
  const [totalInitialSuggestions, setTotalInitialSuggestions] = useState(0);
  const [currentSuggestedIndex, setCurrentSuggestedIndex] = useState(0);
  const [startConfirmed, setStartConfirmed] = useState(false); // Initialize false
  const [draggedDiagnosis, setDraggedDiagnosis] = useState<Diagnosis | null>(null);

  // --- Constants ---
  const API_BASE_URL = 'https://2dhwe1ghfi.execute-api.us-east-1.amazonaws.com'; // Your actual URL

  // --- Helper Functions ---

  /**
   * Sorts an array of groups alphabetically by name.
   * @param arr The array of groups to sort.
   * @returns A new sorted array of groups.
   */
  const sortGroupsAlphabetically = (arr: Group[]): Group[] => {
    // Create a shallow copy before sorting to avoid mutating the original state directly
    return [...arr].sort((a, b) => a.name.localeCompare(b.name));
  };

  /**
   * Uploads the current state (confirmed groups and unsorted diagnoses) to S3 via a presigned URL.
   * Falls back to localStorage if API is not configured or fails.
   * @param currentGroups The current array of confirmed groups.
   * @param currentDeleted The current array of deleted/unsorted diagnoses.
   */
  const uploadGroupedData = async (currentGroups: Group[], currentDeleted: Diagnosis[]) => {
    const dataToSave: SavedSessionData = {
        confirmedGroups: currentGroups,
        unsortedDiagnoses: currentDeleted
    };

    if (!computingId.trim()) {
      console.warn('Computing ID is empty, skipping S3 upload.');
      return;
    }
    // Check if API_BASE_URL is the placeholder or otherwise invalid
    if (!API_BASE_URL.startsWith('https')) {
        console.warn('API_BASE_URL is not configured or invalid, skipping S3 upload.');
        // Fallback to localStorage
        localStorage.setItem(`${computingId}_grouped_diagnoses_fallback`, JSON.stringify(dataToSave));
        console.log('Data saved to localStorage as fallback.');
        return;
    }
    try {
      // 1. Get presigned URL for PUT operation
      const presignedUrlResponse = await fetch(`${API_BASE_URL}/get-presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json`, action: 'putObject' }) // Specify action
      });
      if (!presignedUrlResponse.ok) {
          let errorDetails = `Status: ${presignedUrlResponse.status}`;
          try { const errorJson = await presignedUrlResponse.json(); errorDetails += `, Message: ${errorJson.error || errorJson.message || JSON.stringify(errorJson)}`; } catch (e) { /* Ignore */ }
          throw new Error(`Failed to get presigned URL for upload: ${errorDetails}`);
      }
      const { url: presignedS3Url } = await presignedUrlResponse.json();
      if (!presignedS3Url) throw new Error('Presigned URL for upload was not returned.');

      // 2. PUT data to S3 using the presigned URL
      await fetch(presignedS3Url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' }, // S3 needs this header if the data is JSON
        body: JSON.stringify(dataToSave) // Save the combined object
      });

      console.log('Data successfully auto-saved to S3.');
      // Also update local storage cache on successful S3 save
      localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(dataToSave));
    } catch (error) {
      console.error('Auto-save to S3 failed:', error);
      // Fallback to localStorage on S3 error
      localStorage.setItem(`${computingId}_grouped_diagnoses_fallback`, JSON.stringify(dataToSave));
      console.warn('Data saved to localStorage as a fallback due to S3 error.');
    }
  };

  // Create a debounced version of the upload function
  const debouncedUpload = useRef(debounce((currentGroups: Group[], currentDeleted: Diagnosis[]) => {
      uploadGroupedData(currentGroups, currentDeleted);
  }, 1000)).current; // Debounce for 1 second

  // --- Effects ---

  // Effect to load computing ID from localStorage ONCE on mount
  useEffect(() => {
    const lastId = localStorage.getItem('lastComputingId');
    if (lastId) {
      setComputingId(lastId); // Pre-fill ID input
    }
    // Ensure startConfirmed is false on initial mount/refresh
    setStartConfirmed(false);
  }, []); // Empty dependency array ensures this runs only once

  // Main data loading effect - runs when start is confirmed or computing ID changes
  useEffect(() => {
    const loadAllData = async () => {
      // Guard: Only run if confirmed AND has a valid ID
      if (!startConfirmed || !computingId.trim()) {
          // Reset states if conditions aren't met
          setGroups([]);
          setSuggestedGroups([]);
          setDeletedDiagnoses([]);
          setTotalInitialSuggestions(0);
          setLoading(false); // Ensure loading is false if we return early
          return;
      }
      setLoading(true);
      setTotalInitialSuggestions(0);
      setDeletedDiagnoses([]); // Reset deleted list when loading for a specific ID

      let loadedDataFromSource: Group[] | SavedSessionData | null = null;

      // --- Fetch Saved Session Data (Groups & Deleted) ---
      if (!API_BASE_URL.startsWith('https')) {
        // Handle case where API is not configured - load only from localStorage
        console.warn('API_BASE_URL is not configured or invalid. Attempting to load from localStorage only.');
        const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
        if (saved) {
          try { loadedDataFromSource = JSON.parse(saved); } catch (e) { console.error('Failed to parse saved session data from localStorage', e); loadedDataFromSource = null; }
        }
      } else {
        // Try fetching from S3 via API Gateway
        try {
          // 1. Get presigned URL for GET operation
          const presignedUrlResponse = await fetch(`${API_BASE_URL}/get-presigned-url`, {
             method: 'POST', headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ filename: `${computingId}_grouped_diagnoses.json`, action: 'getObject' }) // Specify action
          });
          if (!presignedUrlResponse.ok) {
             let errorDetails = `Status: ${presignedUrlResponse.status}`;
             try { const errorJson = await presignedUrlResponse.json(); errorDetails += `, Message: ${errorJson.error || errorJson.message || JSON.stringify(errorJson)}`; } catch (e) { /* Ignore */ }
             throw new Error(`Presigned URL fetch failed: ${errorDetails}`);
          }
          const responseJson = await presignedUrlResponse.json();
          const presignedS3Url = responseJson.url;
          if (!presignedS3Url) throw new Error('Presigned URL for session data not returned by API.');

          // 2. GET data from S3 using the presigned URL
          const s3DataResponse = await fetch(presignedS3Url);
          if (!s3DataResponse.ok) {
              // Handle file not found specifically (common for new users)
              if (s3DataResponse.status === 404 || s3DataResponse.status === 403) { // 403 can sometimes mean Not Found for presigned GETs
                  console.log(`S3 file not found for ${computingId}, initializing empty session.`);
                  loadedDataFromSource = null; // Treat as no saved data
              } else {
                  // Throw error for other S3 fetch issues
                  throw new Error(`S3 data fetch failed: Status ${s3DataResponse.status}`);
              }
          } else {
              // If S3 fetch succeeded, parse the JSON
              loadedDataFromSource = await s3DataResponse.json();
              // Cache successful S3 load to primary localStorage key
              localStorage.setItem(`${computingId}_grouped_diagnoses`, JSON.stringify(loadedDataFromSource));
          }
        } catch (fetchError) {
          // Fallback to localStorage if S3 fetch process fails
          console.warn('S3 fetch process for session data failed, trying localStorage:', fetchError);
          const saved = localStorage.getItem(`${computingId}_grouped_diagnoses`) || localStorage.getItem(`${computingId}_grouped_diagnoses_fallback`);
          if (saved) try { loadedDataFromSource = JSON.parse(saved); } catch (e) { loadedDataFromSource = null; }
        }
      }

      // --- Process Loaded Data (Handle Old vs New Format) ---
      let loadedConfirmedGroups: Group[] = [];
      let loadedUnsortedDiagnoses: Diagnosis[] = [];

      if (Array.isArray(loadedDataFromSource)) {
          console.warn("Loading data in old format (array only). Unsorted diagnoses list will be empty.");
          loadedConfirmedGroups = loadedDataFromSource; // Assign the array directly
          loadedUnsortedDiagnoses = [];
      } else if (isNewSaveFormat(loadedDataFromSource)) {
          // Handle NEW format (SavedSessionData object)
          loadedConfirmedGroups = loadedDataFromSource.confirmedGroups || [];
          loadedUnsortedDiagnoses = loadedDataFromSource.unsortedDiagnoses || [];
      } else {
          console.log("No valid saved data found or data format unrecognized. Starting fresh.");
          // Keep defaults (empty arrays)
      }

      // --- Fetch Raw Suggested Groups ---
      let rawSuggestedGroupsList: Group[] = [];
      try {
        const res = await fetch('/verification/diagnoses.json'); // Ensure this path is correct for your deployment
        if (!res.ok) { const errorText = await res.text(); throw new Error(`HTTP error fetching suggestions! status: ${res.status}, message: ${errorText}, path: /verification/diagnoses.json`); }
        const data: DiagnosesData = await res.json();
        setTotalInitialSuggestions(Object.keys(data).length); // Set total count based on loaded suggestions
        rawSuggestedGroupsList = Object.entries(data).map(([groupId, value]: [string, [string[], string[]]], index: number) => {
          const [codes, names] = value;
          const diagnoses: Diagnosis[] = names.map((name: string, i: number) => {
            // Generate stable fallback ID if code is missing
            const stableFallbackId = `generated-${groupId}-${name.toLowerCase().replace(/[^a-z0-9]/gi, '')}-${i}`;
            return { id: codes[i] ? codes[i].toString() : stableFallbackId, name, description: '' };
          });
          return {
            id: `suggested-group-${groupId}-${Date.now()}`, // ID for the suggestion container itself
            name: `Suggested Group ${index + 1}`, // Display name
            diagnoses, subgroups: [], collapsed: false
          };
        });
      } catch (error) {
        console.error('Failed to load or parse diagnoses.json:', error);
        setTotalInitialSuggestions(0); // Reset count on error
      }

      // --- Filter Suggestions based on Confirmed and Unsorted/Deleted ---
      const diagnosisIdsToExclude = new Set<string>();
      // Helper to recursively collect diagnosis IDs from confirmed groups
      function collectConfirmedIds(groupList: Group[]) {
        for (const group of groupList) {
          group.diagnoses.forEach(d => diagnosisIdsToExclude.add(d.id));
          if (group.subgroups) collectConfirmedIds(group.subgroups);
        }
      }
      collectConfirmedIds(loadedConfirmedGroups);
      // Also exclude diagnoses that are already in the loaded unsorted list
      loadedUnsortedDiagnoses.forEach(d => diagnosisIdsToExclude.add(d.id));

      // Create the final list of suggestions to display
      const filteredSuggestedGroups = rawSuggestedGroupsList.map(sg => ({
        ...sg,
        diagnoses: sg.diagnoses.filter(d => !diagnosisIdsToExclude.has(d.id)) // Keep only diagnoses NOT already confirmed or unsorted
      }));

      // --- Set States ---
      setGroups(sortGroupsAlphabetically(loadedConfirmedGroups)); // Set confirmed groups (sorted)
      setDeletedDiagnoses(loadedUnsortedDiagnoses); // Set unsorted/deleted diagnoses
      setSuggestedGroups(filteredSuggestedGroups); // Set the filtered suggestions
      setLoading(false); // Done loading
    };

    // Trigger data loading when dependencies change
    loadAllData();

  }, [startConfirmed, computingId]); // Re-run loadAllData if startConfirmed or computingId changes

  // Effect to update the index pointing to the current suggestion to display
  useEffect(() => {
    // Don't calculate index if not started
    if (!startConfirmed) {
        setCurrentSuggestedIndex(0);
        return;
    }
    // If no suggestions (either initially or after filtering), index is 0
    if (suggestedGroups.length === 0) {
      setCurrentSuggestedIndex(0);
      return;
    }
    // Find the index of the first suggestion group that still contains diagnoses
    const nextIncompleteIndex = suggestedGroups.findIndex((sg: Group) => sg.diagnoses.length > 0);

    // If found, set index to that; otherwise, set it past the end (indicates suggestions are done)
    setCurrentSuggestedIndex(nextIncompleteIndex !== -1 ? nextIncompleteIndex : suggestedGroups.length);

  }, [suggestedGroups, startConfirmed]); // Re-calculate when the filtered suggestions list changes or start state changes

  // --- Event Handlers & Other Functions ---

  /** Sets the diagnosis being dragged. */
  const handleDragStart = (diagnosis: Diagnosis) => setDraggedDiagnosis(diagnosis);

  /** Recursively finds the target group/subgroup and adds the dropped diagnosis. */
  const processDropInGroups = (currentGroups: Group[], targetGroupId: string, diagnosisToDrop: Diagnosis): Group[] => {
    return currentGroups.map((group: Group) => {
      // Filter out the diagnosis if it exists directly in this group (it shouldn't, but as a safeguard)
      let diagnosesInGroup = group.diagnoses.filter((d: Diagnosis) => d.id !== diagnosisToDrop.id);
      // Recursively process subgroups
      let subgroupsInGroup = group.subgroups ? processDropInGroups(group.subgroups, targetGroupId, diagnosisToDrop) : [];
      // If the current group is the target, add the diagnosis (if not already present)
      if (group.id === targetGroupId && !diagnosesInGroup.find((d: Diagnosis) => d.id === diagnosisToDrop.id)) {
        diagnosesInGroup = [...diagnosesInGroup, diagnosisToDrop];
      }
      return { ...group, diagnoses: diagnosesInGroup, subgroups: subgroupsInGroup };
    });
  };

  /** Handles dropping a diagnosis onto a confirmed group/subgroup. */
  const handleDrop = (targetGroupId: string) => {
    if (!draggedDiagnosis) return; // Should not happen if drag started correctly

    // Save previous state for undo functionality
    setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]);

    // Add the diagnosis to the target group in the confirmed groups structure
    const updatedConfirmedGroups = processDropInGroups(groups, targetGroupId, draggedDiagnosis);

    // Remove the dropped diagnosis from the list it came from (either suggestions or deleted list)
    const updatedSuggestedGroups = suggestedGroups.map((sg: Group) => ({
      ...sg, diagnoses: sg.diagnoses.filter((d: Diagnosis) => d.id !== draggedDiagnosis!.id) // Use non-null assertion
    }));
    const updatedDeletedDiagnoses = deletedDiagnoses.filter((d: Diagnosis) => d.id !== draggedDiagnosis!.id); // Use non-null assertion

    // Update state
    setGroups(updatedConfirmedGroups); // Note: Sorting is handled on load/add, not needed here
    setSuggestedGroups(updatedSuggestedGroups); // This update will trigger the index useEffect
    setDeletedDiagnoses(updatedDeletedDiagnoses);
    debouncedUpload(updatedConfirmedGroups, updatedDeletedDiagnoses); // Save the new state (pass both parts)
    setDraggedDiagnosis(null); // Clear the dragged item
  };

  /** Adds a new, empty subgroup to a specified parent group/subgroup. */
  const addSubgroup = (parentGroupId: string) => {
    const name = prompt('Enter subgroup name:');
    if (!name || !name.trim()) return; // Cancelled or empty name

    setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); // Save state for undo

    const newSubgroup: Group = {
      id: crypto.randomUUID(), // Generate unique ID
      name: name.trim(),
      diagnoses: [],
      subgroups: [],
      collapsed: false,
    };

    // Recursive function to find the parent and add the subgroup
    const addSubgroupRecursive = (currentGroups: Group[]): Group[] => {
      return currentGroups.map((g: Group) => {
        if (g.id === parentGroupId) {
          // Found the parent, add the new subgroup
          return { ...g, subgroups: [...(g.subgroups || []), newSubgroup] };
        }
        if (g.subgroups) {
          // Recursively search in subgroups
          return { ...g, subgroups: addSubgroupRecursive(g.subgroups) };
        }
        // Not the parent and no subgroups to search
        return g;
      });
    };

    const updatedGroups = addSubgroupRecursive(groups);
    setGroups(updatedGroups); // Update the confirmed groups state
    debouncedUpload(updatedGroups, deletedDiagnoses); // Save the changes
  };

  /** Toggles the collapsed state of a group/subgroup. */
  const toggleGroupCollapse = (groupId: string) => {
    const toggleRecursive = (currentGroups: Group[]): Group[] => currentGroups.map((g: Group) => {
      if (g.id === groupId) return { ...g, collapsed: !g.collapsed }; // Toggle the state
      if (g.subgroups) return { ...g, subgroups: toggleRecursive(g.subgroups) }; // Recurse
      return g;
    });
    setGroups(toggleRecursive(groups));
    // Note: Collapse state is usually visual only, often no need to trigger save unless persistence is desired.
  };

  /** Handles reordering of subgroups within a parent group. */
  const handleReorderSubgroups = (parentGroupId: string, reorderedSubgroups: Group[]) => {
    setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); // Save state for undo

    // Recursive function to find the parent and update its subgroups array
    const updateSubgroupsOrderRecursive = (currentGroups: Group[], targetParentId: string, newOrder: Group[]): Group[] => {
      return currentGroups.map((g: Group) => {
        if (g.id === targetParentId) {
          // Found the parent, update its subgroups
          return { ...g, subgroups: newOrder as Group[] }; // Assume newOrder is correctly typed Group[]
        }
        if (g.subgroups && g.subgroups.length > 0) {
          // Recursively search in subgroups
          return { ...g, subgroups: updateSubgroupsOrderRecursive(g.subgroups, targetParentId, newOrder) };
        }
        // Not the parent and no subgroups to search
        return g;
      });
    };

    const updatedGroups = updateSubgroupsOrderRecursive(groups, parentGroupId, reorderedSubgroups);
    setGroups(updatedGroups); // Update the confirmed groups state
    debouncedUpload(updatedGroups, deletedDiagnoses); // Save the changes
  };

  /** Handles deleting a group/subgroup and moving its diagnoses to the deleted list. */
  const handleDeleteGroup = (groupIdToDelete: string) => {
    if (!window.confirm("Are you sure you want to delete this group and all items within it? Deleted diagnoses will need to be regrouped.")) return;

    setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); // Save state before deleting

    const diagnosesToMove: Diagnosis[] = [];
    // Recursive helper to find the group/subgroup and collect all diagnoses within it
    function findAndCollectDiagnoses(groupList: Group[], targetId: string): Group | null {
        for (const group of groupList) {
            if (group.id === targetId) {
                // Found the target group, collect diagnoses recursively
                function collectRecursively(currentGroup: Group) {
                    diagnosesToMove.push(...currentGroup.diagnoses);
                    if (currentGroup.subgroups) {
                        currentGroup.subgroups.forEach(collectRecursively);
                    }
                }
                collectRecursively(group);
                return group; // Indicate found
            }
            // If not found at this level, search in subgroups
            if (group.subgroups) {
                const foundInSubgroup = findAndCollectDiagnoses(group.subgroups, targetId);
                if (foundInSubgroup) return foundInSubgroup; // Propagate finding upwards
            }
        }
        return null; // Not found in this branch
    }

    findAndCollectDiagnoses(groups, groupIdToDelete); // Populate diagnosesToMove

    // Recursive function to remove the group/subgroup structure by filtering
    const removeGroupRecursive = (currentGroups: Group[]): Group[] => {
      // Filter out the group at the current level
      const groupsAfterDeletion = currentGroups.filter(g => g.id !== groupIdToDelete);
      // Map over remaining groups to process their subgroups recursively
      return groupsAfterDeletion.map(g => {
        if (g.subgroups && g.subgroups.length > 0) {
          return { ...g, subgroups: removeGroupRecursive(g.subgroups) };
        }
        return g;
      });
    };

    const updatedGroups = removeGroupRecursive(groups); // Get the structure without the deleted group

    let updatedDeletedDiagnoses: Diagnosis[] = []; // To capture the final state for debouncedUpload
    // Add collected diagnoses to the deletedDiagnoses state, avoiding duplicates already there
    setDeletedDiagnoses(prevDeleted => {
        const existingDeletedIds = new Set(prevDeleted.map(d => d.id));
        const newDiagnosesToAdd = diagnosesToMove.filter(d => !existingDeletedIds.has(d.id));
        updatedDeletedDiagnoses = [...prevDeleted, ...newDiagnosesToAdd];
        return updatedDeletedDiagnoses;
    });

    setGroups(updatedGroups); // Update confirmed groups state
    debouncedUpload(updatedGroups, updatedDeletedDiagnoses); // Save the new state
  };

  /** Handles the Undo action. */
  const handleUndo = () => {
    const previousState = undoStack.pop(); // Get the last saved state object from the stack
    if (previousState) {
        // Restore both parts of the state
        setGroups(previousState.confirmedGroups);
        setDeletedDiagnoses(previousState.unsortedDiagnoses);
        setUndoStack([...undoStack]); // Update the stack state (remove the popped item)
        // Save the restored state
        debouncedUpload(previousState.confirmedGroups, previousState.unsortedDiagnoses);
        setSavedMessage('Undo successful.');
        setTimeout(() => setSavedMessage(''), 2000);
    } else {
        // No more states in the undo stack
        setSavedMessage('No more actions to undo.');
        setTimeout(() => setSavedMessage(''), 2000);
    }
  };

  /** Recursively renders a group and its subgroups. */
  const renderGroup = (group: Group, indentLevel = 0): React.JSX.Element => (
    <motion.div
      key={group.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
      onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(group.id); }}
      className={cn('p-3 md:p-4 rounded-md space-y-2 shadow-md mb-3 bg-gray-800 relative group', indentLevel > 0 && 'border border-gray-600')}
      style={{ marginLeft: `${indentLevel * 20}px` }}
    >
      {/* Group Header */}
      <div className="flex items-center justify-between gap-2">
        {/* Collapse Toggle & Name */}
        <div className="flex items-center gap-2 flex-grow min-w-0 pr-8">
          <button className="p-1 hover:bg-gray-700 rounded text-gray-400 flex-shrink-0" onClick={e => { e.stopPropagation(); toggleGroupCollapse(group.id); }} aria-label={group.collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`} >
            {group.collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          </button>
          <h3 className="font-semibold text-lg text-white truncate">{group.name}</h3>
        </div>
         {/* Delete Button */}
         <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" onClick={(e) => { e.stopPropagation(); handleDeleteGroup(group.id); }} aria-label={`Delete group ${group.name}`} >
             <Trash2 size={16} />
         </Button>
      </div>
      {/* Group Content (Diagnoses & Subgroups) */}
      {!group.collapsed && (
        <div className="pl-2 md:pl-4 pt-2 space-y-2">
          {/* Diagnoses List */}
          {group.diagnoses.map((d: Diagnosis) => (
            <motion.div key={d.id} draggable onDragStart={() => handleDragStart(d)} className="bg-gray-700 p-2 rounded-md cursor-grab hover:bg-gray-600 transition-colors" layoutId={`diagnosis-${d.id}`} >
                 <p className="text-sm text-gray-200">{d.name}</p>
            </motion.div>
          ))}
          {/* Subgroups List (Reorderable) */}
          {(group.subgroups && group.subgroups.length > 0) && (
            <Reorder.Group axis="y" values={group.subgroups} onReorder={(newOrder) => handleReorderSubgroups(group.id, newOrder as Group[])} className="space-y-2 pt-2" >
              {group.subgroups.map((sub: Group) => (
                <Reorder.Item key={sub.id} value={sub} className="cursor-grab rounded-md">
                  {renderGroup(sub, indentLevel + 1)}
                </Reorder.Item>
              ))}
            </Reorder.Group>
          )}
          {/* Add Subgroup Button */}
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); addSubgroup(group.id); }} className={cn("mt-2 text-blue-400 hover:text-blue-300 text-xs")} >
             <Plus size={14} className="mr-1" /> Add Subgroup
          </Button>
        </div>
      )}
    </motion.div>
  );

  // --- Conditional Rendering: Start Screen vs Main App ---

  // --- Start Confirmation Screen ---
  if (!startConfirmed) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-4 space-y-6">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
          <h1 className="text-2xl sm:text-3xl font-bold text-center text-white mb-6">Diagnosis Grouping Tool</h1>
          <p className="text-center text-gray-400 mb-2">Enter your Computing ID to load your saved progress or start a new session.</p>
          <Input type="text" placeholder="Computing ID (e.g., ast1x)" value={computingId} onChange={(e) => { const value = e.target.value.trim(); setComputingId(value); }} className={cn("w-full mb-4 bg-gray-700 border-gray-600 placeholder-gray-500")} />
          <Button onClick={() => { if (computingId.trim()) { localStorage.setItem('lastComputingId', computingId.trim()); setStartConfirmed(true); } else { alert("Please enter a Computing ID."); } }} disabled={!computingId.trim()} className={cn("w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-500")} > Start / Load Session </Button>
        </div>
      </div>
    );
  }

  // --- Main Application Layout ---
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-6 flex flex-col">
      {/* Header Section */}
      <header className="mb-6 flex flex-wrap justify-between items-center gap-4">
        <h1 className="text-2xl md:text-3xl font-bold text-white">Diagnosis Grouping: <span className="text-blue-400">{computingId}</span></h1>
        <div className="flex gap-2 sm:gap-4 items-center">
            <Button onClick={() => { setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); uploadGroupedData(groups, deletedDiagnoses); setSavedMessage('Progress saved!'); setTimeout(() => setSavedMessage(''), 3000); }} className={cn("bg-green-600 hover:bg-green-700 text-sm sm:text-base")} > Save Progress </Button>
            <Button onClick={handleUndo} disabled={undoStack.length === 0} className={cn("bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-500 text-sm sm:text-base")} > Undo ({undoStack.length}) </Button>
            {savedMessage && <span className="text-sm text-green-400">{savedMessage}</span>}
        </div>
      </header>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-blue-500"></div>
          <span className="ml-4 text-xl text-white">Loading Data...</span>
        </div>
      )}

      {/* Main Content Area (Two Columns) */}
      <main className="flex flex-row gap-4 md:gap-6 flex-grow" style={{ height: 'calc(100vh - 150px)' }}>
        {/* Left Column: Suggestions & Deleted Items */}
        <section className="flex-1 basis-1/2 min-w-0 bg-gray-800 p-4 rounded-lg shadow-lg overflow-y-auto">
          <h2 className="text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-800 py-2 z-10">
             Suggested Diagnoses
             {totalInitialSuggestions > 0 && !loading && ( <span className="text-sm font-normal text-gray-400 ml-2"> ({currentSuggestedIndex < suggestedGroups.length ? currentSuggestedIndex + 1 : totalInitialSuggestions} / {totalInitialSuggestions}) </span> )}
          </h2>
          {/* Conditional Rendering for Suggestions */}
          {!loading && suggestedGroups.length > 0 && currentSuggestedIndex < suggestedGroups.length && suggestedGroups[currentSuggestedIndex] ? (
            <>
              {/* Suggestion Action Box */}
              <div className="mb-4 p-3 bg-gray-700 rounded-md text-white">
                <p className="text-md font-medium mb-2"> {suggestedGroups[currentSuggestedIndex].name || `Suggestion ${currentSuggestedIndex + 1}`}: How would you like to group these? </p>
                <div className="flex gap-2 sm:gap-4">
                  <Button onClick={() => { const currentSuggestion = suggestedGroups[currentSuggestedIndex]; if (!currentSuggestion || currentSuggestion.diagnoses.length === 0) return; const inputName = prompt('Enter a name for this new group:', currentSuggestion.name); if (!inputName || !inputName.trim()) return; const trimmedName = inputName.trim(); setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); const existingGroup = groups.find((g: Group) => g.name.toLowerCase() === trimmedName.toLowerCase()); if (existingGroup) { const updatedGroups = groups.map((g: Group) => { if (g.id === existingGroup.id) { const diagnosesToAdd = currentSuggestion.diagnoses.filter( (sd: Diagnosis) => !g.diagnoses.some((d: Diagnosis) => d.id === sd.id) ); return { ...g, diagnoses: [...g.diagnoses, ...diagnosesToAdd] }; } return g; }); setGroups(updatedGroups); debouncedUpload(updatedGroups, deletedDiagnoses); } else { const newGroup: Group = { id: crypto.randomUUID(), name: trimmedName, diagnoses: [...currentSuggestion.diagnoses], subgroups: [], collapsed: false }; const updatedGroups = sortGroupsAlphabetically([...groups, newGroup]); setGroups(updatedGroups); debouncedUpload(updatedGroups, deletedDiagnoses); } const updatedSuggested = suggestedGroups.map((sg: Group, idx: number) => idx === currentSuggestedIndex ? { ...sg, diagnoses: [] } : sg ); setSuggestedGroups(updatedSuggested); }} className={cn("bg-blue-600 hover:bg-blue-700 text-xs sm:text-sm flex-1")} disabled={!suggestedGroups[currentSuggestedIndex]?.diagnoses || suggestedGroups[currentSuggestedIndex].diagnoses.length === 0} > Create / Merge Group </Button>
                </div>
                 <p className="text-xs text-gray-400 mt-2"> Or, drag them individually to your groups on the right. </p>
              </div>
              {/* List of Draggable Suggested Diagnoses */}
              <div className="space-y-2">
                {(suggestedGroups[currentSuggestedIndex]?.diagnoses || []).map((d: Diagnosis) => ( <motion.div key={d.id} draggable onDragStart={() => handleDragStart(d)} className="bg-gray-700 rounded-md p-3 cursor-grab hover:bg-gray-600 transition-colors" layoutId={`diagnosis-${d.id}-suggested`} > <h3 className="text-sm font-medium text-gray-200">{d.name}</h3> </motion.div> ))}
              </div>
              {suggestedGroups[currentSuggestedIndex]?.diagnoses.length > 0 && <p className="text-xs text-gray-400 mt-3">These items must be grouped before proceeding.</p> }
            </>
          ) : null }
          {/* Conditional Rendering for Deleted/Unsorted Diagnoses */}
          {!loading && currentSuggestedIndex >= suggestedGroups.length && deletedDiagnoses.length > 0 && (
             <div className="mt-6 pt-4 border-t border-gray-700">
                <h3 className="text-lg font-semibold text-yellow-400 mb-3">Deleted / Unsorted Diagnoses</h3>
                <p className="text-xs text-gray-400 mb-3">These diagnoses were removed from deleted groups. Please drag them into a confirmed group.</p>
                <div className="space-y-2">
                    {deletedDiagnoses.map((d: Diagnosis) => ( <motion.div key={`deleted-${d.id}`} draggable onDragStart={() => handleDragStart(d)} className="bg-yellow-900 border border-yellow-700 rounded-md p-3 cursor-grab hover:bg-yellow-800 transition-colors" layoutId={`diagnosis-${d.id}-deleted`} > <h3 className="text-sm font-medium text-yellow-100">{d.name}</h3> </motion.div> ))}
                </div>
             </div>
          )}
          {/* Conditional Rendering for Fallback Messages */}
          {!loading && currentSuggestedIndex >= suggestedGroups.length && deletedDiagnoses.length === 0 && (
            <p className="text-gray-400 p-3">
                {totalInitialSuggestions === 0 && "No suggestions loaded or an error occurred."}
                {totalInitialSuggestions > 0 && "All suggestions have been processed. You can continue to create groups manually."}
            </p>
          )}
           {loading && ( <p className="text-gray-400 p-3">Loading and processing suggestions...</p> )}
        </section>

        {/* Right Column: Confirmed Groups */}
        <section className="flex-1 basis-1/2 min-w-0 bg-gray-850 p-4 rounded-lg shadow-lg overflow-y-auto relative">
          <h2 className="text-xl font-semibold text-white mb-3 sticky top-0 bg-gray-850 py-2 z-10">Your Confirmed Groups</h2>
          <AnimatePresence> {groups.map((group: Group) => renderGroup(group, 0))} </AnimatePresence>
          {/* Add New Group Controls */}
          <div className="mt-6 sticky bottom-0 bg-gray-850 py-3">
            {showAddGroupInput ? (
              <div className="flex flex-col sm:flex-row items-center gap-2 p-3 bg-gray-700 rounded-md">
                <Input type="text" placeholder="New Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className={cn("flex-grow bg-gray-600 border-gray-500 placeholder-gray-400")} />
                <div className="flex gap-2">
                    <Button onClick={() => { const trimmedNewGroupName = newGroupName.trim(); if (!trimmedNewGroupName) return; const groupNameExists = groups.some((g: Group) => g.name.toLowerCase() === trimmedNewGroupName.toLowerCase()); if (groupNameExists) { alert("A group with this name already exists."); return; } setUndoStack(prev => [...prev.slice(-9), { confirmedGroups: groups, unsortedDiagnoses: deletedDiagnoses }]); const newGroupToAdd: Group = { id: crypto.randomUUID(), name: trimmedNewGroupName, diagnoses: [], subgroups: [], collapsed: false }; const updatedGroups = sortGroupsAlphabetically([...groups, newGroupToAdd]); setGroups(updatedGroups); debouncedUpload(updatedGroups, deletedDiagnoses); setNewGroupName(''); setShowAddGroupInput(false); }} className={cn("bg-blue-600 hover:bg-blue-700")}> Add Group </Button>
                    <Button variant="ghost" onClick={() => {setShowAddGroupInput(false); setNewGroupName('');}} className={cn("hover:bg-gray-600")}> Cancel </Button>
                </div>
              </div>
            ) : (
              <Button onClick={() => setShowAddGroupInput(true)} className={cn("w-full sm:w-auto bg-green-600 hover:bg-green-700")}> <Plus className="w-4 h-4 mr-2" /> Create New Group </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default DiagnosisGroupingApp;
