'use strict';

const Homey = require('homey');
const PetData = require('../../lib/petdata');

module.exports = class PetDevice extends Homey.Device {

  /**
   * Device initialization - sets up capabilities and fetches pet data
   */
  async onInit() {
    this.log('Pet device initialized');

    try {
      // Get pet ID from device data
      const data = this.getData();
      this.petId = data.id;

      if (!this.petId) {
        throw new Error('Invalid device data. Missing pet ID.');
      }

      // Initialize capabilities with loading states
      await this._initializeCapabilities();

      // Register with DataManager for weight updates
      await this._registerWithDataManager();

      // Fetch pet data using centralized session
      await this._fetchPetData();

      this.log('Pet device initialization completed successfully');
    } catch (err) {
      this.error('Failed to initialize pet device:', err);
      throw err;
    }
  }

  /**
   * Initialize all device capabilities with loading states
   * @private
   */
  async _initializeCapabilities() {
    const initialCapabilities = {
      // Measurement capabilities
      measure_weight: null,
      
      // Label capabilities
      label_gender: 'Loading...',
      label_food: 'Loading...',
      label_environment: 'Loading...',
      label_birthday: 'Loading...',
      label_breed: 'Loading...',
      label_age: 'Loading...',
      
      // Alarm capabilities
      alarm_health_concern: false
    };

    // Set all initial values
    for (const [capability, value] of Object.entries(initialCapabilities)) {
      try {
        await this.setCapabilityValue(capability, value);
      } catch (err) {
        this.error(`Failed to initialize capability ${capability}:`, err);
      }
    }

    this.log('Pet capabilities initialized');
  }

  /**
   * Subscribe to weight updates from DataManager
   * @private
   */
  async _registerWithDataManager() {
    try {
      const dataManager = this.homey.app.dataManager;
      if (dataManager) {
        // Subscribe to weight updates (device is already registered during pairing)
        this._weightUnsubscribe = dataManager.subscribeToWeightUpdates((weightData) => {
          this._handleWeightUpdate(weightData);
        });
        
        this.log('Subscribed to weight updates from DataManager');
      }
    } catch (err) {
      this.error('Failed to subscribe to weight updates:', err);
    }
  }

  /**
   * Handle weight updates from DataManager - triggers pet data refresh
   * @param {Object} weightData - Weight data from LR4 (used as trigger only)
   * @private
   */
  async _handleWeightUpdate(weightData) {
    this.log(`\x1b[36mReceived weight update trigger: ${weightData.weight} lbs (${weightData.weightGrams} g) from device ${weightData.sourceDeviceId}\x1b[0m`);
    
    // Use weight update as trigger to refresh pet data via DataManager (centralized)
    try {
      this.log('Weight update detected - refreshing pet data via DataManager...');
      await this.refreshPetData();
      this.log('Pet data refreshed successfully after weight update');
    } catch (err) {
      this.error('Failed to refresh pet data after weight update:', err);
    }
  }

  /**
   * Fetch pet data using centralized session
   * @private
   */
  async _fetchPetData() {
    try {
      const apiSession = this.homey.app.apiSession;
      if (!apiSession) {
        throw new Error('No API session available. Please repair device.');
      }

      const response = await apiSession.petGraphql(`
        query GetPetsByUser($userId: String!) {
          getPetsByUser(userId: $userId) {
            petId
            userId
            name
            type
            gender
            weight
            weightLastUpdated
            lastWeightReading
            breeds
            age
            birthday
            adoptionDate
            s3ImageURL
            diet
            isFixed
            environmentType
            healthConcerns
            isActive
            whiskerProducts
            petTagId
            weightIdFeatureEnabled
          }
        }
      `, { userId: apiSession.getUserId() });

      const pet = response.data?.getPetsByUser?.find(p => String(p.petId) === String(this.petId));
      if (!pet) {
        throw new Error(`Pet with ID ${this.petId} not found`);
      }

      this.petData = new PetData({ pet });
      this.log('Connected to pet:', this.petData.name);

      // Update capabilities with initial data
      this._updateCapabilities(this.petData);

    } catch (err) {
      this.error('Failed to fetch pet data:', err);
      throw err;
    }
  }

  /**
   * Update device capabilities based on pet data
   * @param {PetData} petData - Processed pet data
   * @private
   */
  _updateCapabilities(petData) {
    if (!petData) return;

    // Define capability updates
    const updates = [
      ['measure_weight', petData.weightInGrams],
      ['label_gender', petData.genderLabel],
      ['label_food', petData.dietLabel],
      ['label_environment', petData.environmentLabel],
      ['label_birthday', petData.birthdayFormatted],
      ['label_breed', petData.breedLabel],
      ['label_age', petData.ageLabel],
      ['alarm_health_concern', petData.hasHealthConcerns]
    ];

    // Track changes for Flow card triggering
    const changes = new Set();

    // Update capabilities
    for (const [capability, newValue] of updates) {
      if (newValue === undefined || newValue === null) continue;

      const oldValue = this.getCapabilityValue(capability);
      
      // Handle initialization from loading state
      if (oldValue === 'Loading...') {
        this.log(`\x1b[36mInitializing capability ${capability}: ${newValue}\x1b[0m`);
        this.setCapabilityValue(capability, newValue).catch(err => {
          this.error(`\x1b[31mFailed to initialize capability ${capability}:\x1b[0m`, err);
        });
        continue;
      }

      // Only update if value actually changed
      if (newValue !== oldValue) {
        this.log(`\x1b[33m${capability} changed: ${oldValue} → ${newValue}\x1b[0m`);
        this.setCapabilityValue(capability, newValue).catch(err => {
          this.error(`\x1b[31mFailed to update capability ${capability}:\x1b[0m`, err);
        });
        changes.add(capability);
      }
    }

    // Trigger Flow cards for detected changes
    if (changes.size > 0) {
      this._triggerFlowCards(changes, petData);
    }
  }

  /**
   * Trigger Flow cards based on capability changes
   * @param {Set<string>} changes - Set of changed capabilities
   * @param {PetData} petData - Current pet data
   * @private
   */
  _triggerFlowCards(changes, petData) {
    // Diet changed trigger
    if (changes.has('label_food')) {
      this.homey.flow.getDeviceTriggerCard('diet_changed')
        .trigger(this, { diet: petData.dietLabel })
        .catch(err => this.error('Failed to trigger diet_changed:', err));
    }

    // Environment changed trigger
    if (changes.has('label_environment')) {
      this.homey.flow.getDeviceTriggerCard('environment_changed')
        .trigger(this, { environment: petData.environmentLabel })
        .catch(err => this.error('Failed to trigger environment_changed:', err));
    }

    // Age changed trigger
    if (changes.has('label_age')) {
      this.homey.flow.getDeviceTriggerCard('age_changed')
        .trigger(this, { age: petData.ageLabel })
        .catch(err => this.error('Failed to trigger age_changed:', err));
    }

    // Health concern detected trigger
    if (changes.has('alarm_health_concern') && petData.hasHealthConcerns) {
      const concerns = petData.healthConcernsList?.join(', ');
      if (concerns) {
        this.homey.flow.getDeviceTriggerCard('health_concern_detected')
          .trigger(this, { concerns })
          .catch(err => this.error('Failed to trigger health_concern_detected:', err));
      }
    }
  }

  /**
   * Refresh pet data via DataManager
   * @public
   */
  async refreshPetData() {
    try {
      this.log('Refreshing pet data via DataManager...');
      const dataManager = this.homey.app.dataManager;
      if (dataManager) {
        // Use DataManager's centralized refresh which will update all pet devices efficiently
        await dataManager.refreshDeviceData(this.getData().id, true);
        this.log('Pet data refreshed successfully via DataManager');
      } else {
        // Fallback to direct fetch if DataManager not available
        await this._fetchPetData();
        this.log('Pet data refreshed successfully via direct fetch');
      }
    } catch (err) {
      this.error('Failed to refresh pet data:', err);
    }
  }

  /**
   * Device cleanup when deleted
   */
  onDeleted() {
    this.log('Pet device deleted, cleaning up...');
    
    // Unsubscribe from weight updates
    try {
      if (this._weightUnsubscribe) {
        this._weightUnsubscribe();
        this.log('Unsubscribed from weight updates');
      }
    } catch (err) {
      this.error('Failed to unsubscribe from weight updates:', err);
    }
  }
}