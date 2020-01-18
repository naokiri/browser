import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Angulartics2 } from 'angulartics2';

import { CryptoService } from 'jslib/abstractions/crypto.service';
import { EnvironmentService } from 'jslib/abstractions/environment.service';
import { I18nService } from 'jslib/abstractions/i18n.service';
import { LockService } from 'jslib/abstractions/lock.service';
import { MessagingService } from 'jslib/abstractions/messaging.service';
import { PlatformUtilsService } from 'jslib/abstractions/platformUtils.service';
import { StorageService } from 'jslib/abstractions/storage.service';
import { UserService } from 'jslib/abstractions/user.service';

import { DeviceType } from 'jslib/enums/deviceType';
import {
    LOCK_NEVER,
    LOCK_ON_IDLE,
    LOCK_ON_LOCKED,
    LOCK_ON_RESTART,
    LOCK_ON_SLEEP,
    LOCK_OPTION_SPECIAL_TYPE_VALUES,
    LockOptionSpecialType, LockOptionType, LockOptionValueType,
} from 'jslib/enums/lockOptionType';

import { ConstantsService } from 'jslib/services/constants.service';
import swal from 'sweetalert';

import { BrowserApi } from '../../browser/browserApi';

const RateUrls = {
    [DeviceType.ChromeExtension]:
        'https://chrome.google.com/webstore/detail/bitwarden-free-password-m/nngceckbapebfimnlniiiahkandclblb/reviews',
    [DeviceType.FirefoxExtension]:
        'https://addons.mozilla.org/en-US/firefox/addon/bitwarden-password-manager/#reviews',
    [DeviceType.OperaExtension]:
        'https://addons.opera.com/en/extensions/details/bitwarden-free-password-manager/#feedback-container',
    [DeviceType.EdgeExtension]:
        'https://www.microsoft.com/store/p/bitwarden-free-password-manager/9p6kxl0svnnl',
    [DeviceType.VivaldiExtension]:
        'https://chrome.google.com/webstore/detail/bitwarden-free-password-m/nngceckbapebfimnlniiiahkandclblb/reviews',
    [DeviceType.SafariExtension]:
        'https://apps.apple.com/app/bitwarden/id1352778147',
};

interface ILockOptionModel {
    name: string;
    value: LockOptionType;
}

@Component({
    selector: 'app-settings',
    templateUrl: 'settings.component.html',
})
export class SettingsComponent implements OnInit {
    @ViewChild('lockOptionsSelect', {read: ElementRef}) lockOptionsSelectRef: ElementRef;
    @ViewChild('lockDurationInput') lockDurationRef: ElementRef;
    lockOptionTypes: ILockOptionModel[];
    // The lock option values shown in UI.
    lockOptionType: LockOptionType;
    lockDurationMin: number = null;
    // The lock option in use.
    lockOption: LockOptionValueType = null;
    pin: boolean = null;
    previousLockOption: LockOptionValueType = null;

    constructor(private platformUtilsService: PlatformUtilsService, private i18nService: I18nService,
                private analytics: Angulartics2, private lockService: LockService,
                private storageService: StorageService, public messagingService: MessagingService,
                private router: Router, private environmentService: EnvironmentService,
                private cryptoService: CryptoService, private userService: UserService) {
    }

    /**
     * @internal
     * Convert historically used old number lockOption into the typed one.
     */
    lockOptionToTypedLockOption(value: number | LockOptionValueType): LockOptionValueType {
        if (value === null) {
            return {type: 'never', value: null};
        } else if (typeof value === 'number') {
            switch (value) {
                case -1:
                    return LOCK_ON_RESTART;
                case -2:
                    return LOCK_ON_LOCKED;
                case -3:
                    return LOCK_ON_SLEEP;
                case -4:
                    return LOCK_ON_IDLE;
                default:
                    return {type: 'numMinute', value: Math.abs(value)};
            }
        } else {
            return value;
        }
    }

    async changeLockOptionDuration(newValue: number) {
        if (newValue < 1) {
            newValue = 1;
            this.lockDurationRef.nativeElement.value = newValue;
        }
        if (newValue > 1440) {
            newValue = 1440;
            this.lockDurationRef.nativeElement.value = newValue;
        }
        this.lockDurationMin = newValue;
    }

    async saveLockOptionDuration() {
        await this.saveLockOption({type: 'numMinute', value: this.lockDurationMin});
    }

    async ngOnInit() {
        const showOnLocked = !this.platformUtilsService.isFirefox() && !this.platformUtilsService.isEdge()
            && !this.platformUtilsService.isSafari();

        this.lockOptionTypes = [];

        if (showOnLocked) {
            this.lockOptionTypes.push({name: this.i18nService.t('onLocked'), value: LOCK_ON_LOCKED.type});
        }

        this.lockOptionTypes.push({name: this.i18nService.t('onRestart'), value: LOCK_ON_RESTART.type});
        this.lockOptionTypes.push({name: this.i18nService.t('never'), value: LOCK_NEVER.type});

        const storedOption =
            await this.storageService.get<number | LockOptionValueType>(ConstantsService.lockOptionKey);
        let option = this.lockOptionToTypedLockOption(storedOption);

        if (option.type === LOCK_ON_LOCKED.type && !showOnLocked) {
            option = LOCK_ON_RESTART;
        }
        this.lockOption = option;
        this.lockOptionType = this.lockOption.type;

        if (this.lockOption.type === 'numMinute') {
            this.lockDurationMin = this.lockOption.value;
            // TODO: Translation
            this.lockOptionTypes.push({
                name: 'Lock after specified minutes',
                value: 'numMinute',
            });
        } else {
            this.lockDurationMin = 30;
            this.lockOptionTypes.push({
                name: 'Lock after specified minutes',
                value: 'numMinute',
            });
        }
        await this.changeLockOptionDuration(this.lockDurationMin);

        this.previousLockOption = this.lockOption;

        const pinSet = await this.lockService.isPinLockSet();
        this.pin = pinSet[0] || pinSet[1];
    }

    /**
     * @internal
     * given that user didn't confirm their selection, revert the selection of lockOptionType
     */
    revertLockOptionTypeUISelection() {
        this.lockOptionTypes.forEach((option: any, i) => {
            if (option.value === this.lockOption.type) {
                this.lockOptionsSelectRef.nativeElement.selectedIndex = i;
            }
        });

    }

    async updateLockOptionType(newLockOptionType: LockOptionType) {
        if (newLockOptionType === null || newLockOptionType === LOCK_NEVER.type) {
            const confirmed = await this.platformUtilsService.showDialog(
                this.i18nService.t('neverLockWarning'), null,
                this.i18nService.t('yes'), this.i18nService.t('cancel'), 'warning');
            if (!confirmed) {
                this.revertLockOptionTypeUISelection();
                newLockOptionType = this.lockOption.type;
            }
        }

        this.lockOptionType = newLockOptionType;

        if (newLockOptionType === null || newLockOptionType !== 'numMinute') {
            const specialLockOptionType: LockOptionSpecialType = newLockOptionType as LockOptionSpecialType;
            this.saveLockOption(LOCK_OPTION_SPECIAL_TYPE_VALUES.get(specialLockOptionType));
        }
    }

    async saveLockOption(lockType: LockOptionValueType) {
        this.previousLockOption = this.lockOption;
        this.lockOption = lockType;
        await this.lockService.setLockOption(this.lockOption != null ? this.lockOption.value : null);
        if (this.previousLockOption.type === 'never') {
            this.messagingService.send('bgReseedStorage');
        }
        this.lockOptionType = this.lockOption.type;
        if (this.lockOption.type === 'numMinute') {
            this.lockDurationMin = this.lockOption.value;
        }
    }

    async updatePin() {
        if (this.pin) {
            const div = document.createElement('div');
            const label = document.createElement('label');
            label.className = 'checkbox';
            const checkboxText = document.createElement('span');
            const restartText = document.createTextNode(this.i18nService.t('lockWithMasterPassOnRestart'));
            checkboxText.appendChild(restartText);
            label.innerHTML = '<input type="checkbox" id="master-pass-restart" checked>';
            label.appendChild(checkboxText);
            div.innerHTML = '<input type="text" class="swal-content__input" id="pin-val" autocomplete="off" ' +
                'autocapitalize="none" autocorrect="none" spellcheck="false" inputmode="verbatim">';
            (div.querySelector('#pin-val') as HTMLInputElement).placeholder = this.i18nService.t('pin');
            div.appendChild(label);

            const submitted = await swal({
                text: this.i18nService.t('setYourPinCode'),
                content: { element: div },
                buttons: [this.i18nService.t('cancel'), this.i18nService.t('submit')],
            });
            let pin: string = null;
            let masterPassOnRestart: boolean = null;
            if (submitted) {
                pin = (document.getElementById('pin-val') as HTMLInputElement).value;
                masterPassOnRestart = (document.getElementById('master-pass-restart') as HTMLInputElement).checked;
            }
            if (pin != null && pin.trim() !== '') {
                const kdf = await this.userService.getKdf();
                const kdfIterations = await this.userService.getKdfIterations();
                const email = await this.userService.getEmail();
                const pinKey = await this.cryptoService.makePinKey(pin, email, kdf, kdfIterations);
                const key = await this.cryptoService.getKey();
                const pinProtectedKey = await this.cryptoService.encrypt(key.key, pinKey);
                if (masterPassOnRestart) {
                    const encPin = await this.cryptoService.encrypt(pin);
                    await this.storageService.save(ConstantsService.protectedPin, encPin.encryptedString);
                    this.lockService.pinProtectedKey = pinProtectedKey;
                } else {
                    await this.storageService.save(ConstantsService.pinProtectedKey, pinProtectedKey.encryptedString);
                }
            } else {
                this.pin = false;
            }
        }
        if (!this.pin) {
            await this.cryptoService.clearPinProtectedKey();
            await this.lockService.clear();
        }
    }

    async lock() {
        this.analytics.eventTrack.next({ action: 'Lock Now' });
        await this.lockService.lock(true);
    }

    async logOut() {
        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('logOutConfirmation'), this.i18nService.t('logOut'),
            this.i18nService.t('yes'), this.i18nService.t('cancel'));
        if (confirmed) {
            this.messagingService.send('logout');
        }
    }

    async changePassword() {
        this.analytics.eventTrack.next({ action: 'Clicked Change Password' });
        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('changeMasterPasswordConfirmation'), this.i18nService.t('changeMasterPassword'),
            this.i18nService.t('yes'), this.i18nService.t('cancel'));
        if (confirmed) {
            BrowserApi.createNewTab('https://help.bitwarden.com/article/change-your-master-password/');
        }
    }

    async twoStep() {
        this.analytics.eventTrack.next({ action: 'Clicked Two-step Login' });
        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('twoStepLoginConfirmation'), this.i18nService.t('twoStepLogin'),
            this.i18nService.t('yes'), this.i18nService.t('cancel'));
        if (confirmed) {
            BrowserApi.createNewTab('https://help.bitwarden.com/article/setup-two-step-login/');
        }
    }

    async share() {
        this.analytics.eventTrack.next({ action: 'Clicked Share Vault' });
        const confirmed = await this.platformUtilsService.showDialog(
            this.i18nService.t('shareVaultConfirmation'), this.i18nService.t('shareVault'),
            this.i18nService.t('yes'), this.i18nService.t('cancel'));
        if (confirmed) {
            BrowserApi.createNewTab('https://help.bitwarden.com/article/what-is-an-organization/');
        }
    }

    async webVault() {
        this.analytics.eventTrack.next({ action: 'Clicked Web Vault' });
        let url = this.environmentService.getWebVaultUrl();
        if (url == null) {
            url = 'https://vault.bitwarden.com';
        }
        BrowserApi.createNewTab(url);
    }

    import() {
        this.analytics.eventTrack.next({ action: 'Clicked Import Items' });
        BrowserApi.createNewTab('https://help.bitwarden.com/article/import-data/');
    }

    export() {
        if (this.platformUtilsService.isEdge()) {
            BrowserApi.createNewTab('https://help.bitwarden.com/article/export-your-data/');
            return;
        }

        this.router.navigate(['/export']);
    }

    help() {
        this.analytics.eventTrack.next({ action: 'Clicked Help and Feedback' });
        BrowserApi.createNewTab('https://help.bitwarden.com/');
    }

    about() {
        this.analytics.eventTrack.next({ action: 'Clicked About' });

        const year = (new Date()).getFullYear();
        const versionText = document.createTextNode(
            this.i18nService.t('version') + ': ' + BrowserApi.getApplicationVersion());
        const div = document.createElement('div');
        div.innerHTML = `<p class="text-center"><i class="fa fa-shield fa-3x" aria-hidden="true"></i></p>
            <p class="text-center"><b>Bitwarden</b><br>&copy; 8bit Solutions LLC 2015-` + year + `</p>`;
        div.appendChild(versionText);

        swal({
            content: { element: div },
            buttons: [this.i18nService.t('close'), false],
        });
    }

    async fingerprint() {
        this.analytics.eventTrack.next({ action: 'Clicked Fingerprint' });

        const fingerprint = await this.cryptoService.getFingerprint(await this.userService.getUserId());
        const p = document.createElement('p');
        p.innerText = this.i18nService.t('yourAccountsFingerprint') + ':';
        const p2 = document.createElement('p');
        p2.innerText = fingerprint.join('-');
        const div = document.createElement('div');
        div.appendChild(p);
        div.appendChild(p2);

        const result = await swal({
            content: { element: div },
            buttons: [this.i18nService.t('close'), this.i18nService.t('learnMore')],
        });

        if (result) {
            this.platformUtilsService.launchUri('https://help.bitwarden.com/article/fingerprint-phrase/');
        }
    }

    rate() {
        this.analytics.eventTrack.next({ action: 'Rate Extension' });
        BrowserApi.createNewTab((RateUrls as any)[this.platformUtilsService.getDevice()]);
    }
}
